class TabError(Exception):
    """A failure the person can act on. `code` is one of: download_failed, no_guitar, failed."""
    def __init__(self, code, detail=''):
        super().__init__(detail or code)
        self.code = code
