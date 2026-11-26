"""The network of Noise2Fret (Simionato & Bigo, ISMIR 2026), laid out exactly as in the authors'
code (github.com/RiccardoVib/Noise2Fret, MIT licence) so their published weights load into it.
Only what running the model needs is here; training code is not."""
from math import pi

import torch
import torch.nn as nn
import torch.nn.functional as F


class Modulation(nn.Module):
    def __init__(self, channels, cond_dim):
        super().__init__()
        self.proj = nn.Linear(cond_dim, channels * 2)

    def forward(self, x, cond):
        scale, shift = self.proj(cond).chunk(2, dim=-1)
        return x * (1 + scale.unsqueeze(-1)) + shift.unsqueeze(-1)


class SelfAttention(nn.Module):
    def __init__(self, channels, dropout=0.1):
        super().__init__()
        self.norm = nn.GroupNorm(8, channels)
        self.qkv = nn.Conv1d(channels, channels * 3, 1)
        self.proj = nn.Conv1d(channels, channels, 1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        B, C, L = x.shape
        q, k, v = self.qkv(self.norm(x)).view(B, 3, C, L).unbind(1)
        attn = self.dropout(F.softmax(torch.matmul(q.transpose(-2, -1), k) / (C ** 0.5), dim=-1))
        return x + self.dropout(self.proj(torch.matmul(v, attn.transpose(-2, -1))))


class FeedForward(nn.Module):
    def __init__(self, channels, dropout=0.1):
        super().__init__()
        self.norm = nn.GroupNorm(8, channels)
        self.ff = nn.Sequential(nn.Conv1d(channels, channels * 2, 1), nn.GELU(), nn.Dropout(dropout),
                                nn.Conv1d(channels * 2, channels, 1))

    def forward(self, x):
        return x + self.ff(self.norm(x))


class InjectionBlock(nn.Module):
    def __init__(self, channels, inject_channels):
        super().__init__()
        self.proj = nn.Conv1d(inject_channels, channels, 1)

    def forward(self, x, inject_feat):
        if inject_feat.shape[-1] != x.shape[-1]:
            inject_feat = F.interpolate(inject_feat, size=x.shape[-1], mode='linear')
        return x + self.proj(inject_feat)


class AudioEncoder(nn.Module):
    def __init__(self, audio_embed_dim=64, dropout=0.05):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv1d(1, 16, kernel_size=15, stride=4, padding=7), nn.SiLU(),
            nn.Conv1d(16, 32, kernel_size=9, stride=4, padding=4), nn.SiLU(),
            nn.Conv1d(32, audio_embed_dim, kernel_size=5, stride=4, padding=2), nn.SiLU(),
            nn.Dropout(p=dropout))

    def forward(self, audio):
        return self.encoder(audio.permute(0, 2, 1))


class ResNetBlock(nn.Module):
    def __init__(self, in_ch, out_ch, time_dim, use_attention=False, audio_ch=None, inject_ch=None, dropout=0.1):
        super().__init__()
        self.block1 = nn.Sequential(nn.GroupNorm(8, in_ch), nn.SiLU(), nn.Conv1d(in_ch, out_ch, 3, padding=1))
        self.time_proj = nn.Sequential(nn.SiLU(), nn.Linear(time_dim, out_ch))
        self.block2 = nn.Sequential(nn.GroupNorm(8, out_ch), nn.SiLU(), nn.Conv1d(out_ch, out_ch, 3, padding=1),
                                    nn.Dropout(dropout))
        self.shortcut = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()
        self.modulation = Modulation(out_ch, time_dim)
        self.attention = SelfAttention(out_ch) if use_attention else None
        self.feedforward = FeedForward(out_ch, dropout=dropout)
        self.injection = InjectionBlock(out_ch, inject_ch) if inject_ch else None
        if audio_ch:
            self.audio_injection = InjectionBlock(out_ch, audio_ch)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x, time_emb, audio_feat, inject_feat):
        h = self.block1(x)
        h = h + self.time_proj(time_emb).unsqueeze(-1)
        h = self.block2(h) + self.shortcut(x)
        h = self.modulation(h, time_emb)
        h = self.injection(h, inject_feat)
        h = self.audio_injection(h, audio_feat)
        if self.attention:
            h = self.attention(h)
        return self.feedforward(h)


class TokenUNet(nn.Module):
    def __init__(self, in_channels, base_channels=64, time_dim=128, max_len=64, inject_feature_dim=1,
                 audio_embed_dim=64, dropout=0.1):
        super().__init__()
        b, kw = base_channels, dict(audio_ch=audio_embed_dim, inject_ch=base_channels, dropout=dropout)
        self.pos_emb = nn.Embedding(max_len, in_channels)
        self.time_emb = nn.Sequential(nn.Linear(time_dim, time_dim), nn.SiLU(), nn.Linear(time_dim, time_dim))
        self.input_dropout = nn.Dropout(dropout)
        self.input_conv = nn.Conv1d(in_channels, b, 3, padding=1)
        self.c_conv = nn.Conv1d(inject_feature_dim, b, 3, padding=1)
        self.audio_encoder = AudioEncoder(audio_embed_dim)
        self.down1 = ResNetBlock(b, b * 2, time_dim, **kw)
        self.down2 = ResNetBlock(b * 2, b * 4, time_dim, **kw)
        self.down3 = ResNetBlock(b * 4, b * 8, time_dim, **kw)
        self.down4 = ResNetBlock(b * 8, b * 8, time_dim, **kw)
        self.downsample = nn.Conv1d(b * 8, b * 8, 3, stride=2, padding=1)
        self.mid = ResNetBlock(b * 8, b * 8, time_dim, use_attention=True, **kw)
        self.upsample = nn.ConvTranspose1d(b * 8, b * 8, 4, stride=2, padding=1)
        self.up1 = ResNetBlock(b * 16, b * 4, time_dim, **kw)
        self.up2 = ResNetBlock(b * 12, b * 2, time_dim, **kw)
        self.up3 = ResNetBlock(b * 6, b, time_dim, **kw)
        self.up4 = ResNetBlock(b * 3, b, time_dim, **kw)
        self.output = nn.Sequential(nn.GroupNorm(8, b), nn.SiLU(), nn.Conv1d(b, in_channels, kernel_size=3, padding=1))

    def forward(self, noisy_tokens, time, inject_audio, inject_features):
        L = noisy_tokens.shape[1]
        t = self.time_emb(time)
        pos = self.pos_emb(torch.arange(L, device=noisy_tokens.device).unsqueeze(0)).permute(0, 2, 1)
        x = self.input_dropout(self.input_conv(noisy_tokens.permute(0, 2, 1) + pos))
        feats = self.c_conv(inject_features.permute(0, 2, 1))
        audio = self.audio_encoder(inject_audio)
        skip1 = self.down1(x, t, audio, feats)
        skip2 = self.down2(skip1, t, audio, feats)
        skip3 = self.down3(skip2, t, audio, feats)
        skip4 = self.down4(skip3, t, audio, feats)
        x = self.upsample(self.mid(self.downsample(skip4), t, audio, feats))
        if x.shape[-1] != skip4.shape[-1]:
            x = F.interpolate(x, size=skip4.shape[-1], mode='linear', align_corners=False)
        x = self.up1(torch.cat([x, skip4], dim=1), t, audio, feats)
        x = self.up2(torch.cat([x, skip3], dim=1), t, audio, feats)
        x = self.up3(torch.cat([x, skip2], dim=1), t, audio, feats)
        x = self.up4(torch.cat([x, skip1], dim=1), t, audio, feats)
        return self.output(x).permute(0, 2, 1)


class NumberEmbedder(nn.Module):
    """Turns a noise level into the vector the network is told the time with."""
    def __init__(self, features, dim=256):
        super().__init__()
        self.weights = nn.Parameter(torch.randn(dim // 2))
        self.to_out = nn.Linear(dim + 1, features)

    def to_embedding(self, x):
        x = x.unsqueeze(-1)
        freqs = x * self.weights.unsqueeze(0) * 2 * pi
        return self.to_out(torch.cat((x, freqs.sin(), freqs.cos()), dim=-1))


class Noise2Fret(nn.Module):
    """The whole model, built to the sizes found in a checkpoint. `sample` returns, for a batch of
    short windows of sound, per-string scores over classes (0 = not played, 1 = open, k = fret k-1)
    for each of a few event slots."""
    def __init__(self, checkpoint):
        super().__init__()
        embedding = checkpoint['embedding_state_dict']['weight']
        net = checkpoint['model_state_dict']
        self.n_classes, self.embed_dim = embedding.shape
        self.max_events = net['pos_emb.weight'].shape[0]
        self.model = TokenUNet(in_channels=6 * self.embed_dim, base_channels=net['input_conv.weight'].shape[0],
                               inject_feature_dim=net['c_conv.weight'].shape[1], max_len=self.max_events)
        self.encoder = NumberEmbedder(128)
        self.embeddings = nn.Embedding(self.n_classes, self.embed_dim)
        self.model.load_state_dict(net)
        self.encoder.load_state_dict(checkpoint['time_embedding_state_dict'])
        self.embeddings.load_state_dict(checkpoint['embedding_state_dict'])

    @torch.no_grad()
    def sample(self, audio, cond, steps=1, generator=None):
        """audio: (B, samples, 1); cond: (B, frames, features). Returns logits (B, events, 6, classes)."""
        B, device = audio.shape[0], audio.device
        x = torch.randn(B, self.max_events, 6 * self.embed_dim, device=device, generator=generator)
        sigmas = torch.linspace(1.0, 0.0, steps + 1, device=device)
        alphas, betas = torch.cos(sigmas * pi / 2), torch.sin(sigmas * pi / 2)
        for i in range(steps):
            v = self.model(x, self.encoder.to_embedding(sigmas[i].repeat(B)), audio, cond)
            clean = alphas[i] * x - betas[i] * v
            noise = betas[i] * x + alphas[i] * v
            x = alphas[i + 1] * clean + betas[i + 1] * noise
        return x.view(B, self.max_events, 6, self.embed_dim) @ self.embeddings.weight.T
