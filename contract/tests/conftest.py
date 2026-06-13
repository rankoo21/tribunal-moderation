"""
Pytest configuration / Windows compatibility shim for genlayer-test direct mode.

Why this exists
---------------
genlayer-test's direct-mode loader (gltest/direct/loader.py) writes the encoded
call message to a temp file, redirects stdin to it with os.dup2(fd, 0), and then
immediately calls os.unlink(path) in a `finally` block.

On POSIX this works (you can unlink an open file). On Windows, deleting a file
that is still open raises:

    PermissionError: [WinError 32] The process cannot access the file because it
    is being used by another process

That kills every direct-mode test through no fault of the contract under test.

The fix: make os.unlink tolerant of WinError 32 for files living in the system
temp directory. When the file is still locked, we defer its deletion to process
exit instead of failing. This is scoped narrowly (temp dir + PermissionError)
so it cannot hide real deletion errors in the contract or test code.
"""

import os
import sys
import atexit
import tempfile

if sys.platform.startswith("win"):
    _real_unlink = os.unlink
    _temp_root = os.path.realpath(tempfile.gettempdir())
    _deferred: list[str] = []

    def _safe_unlink(path, *args, **kwargs):
        try:
            return _real_unlink(path, *args, **kwargs)
        except PermissionError:
            # Only tolerate locked files inside the system temp directory.
            try:
                real = os.path.realpath(path)
            except Exception:
                raise
            if real.startswith(_temp_root):
                _deferred.append(real)
                return None
            raise

    def _cleanup_deferred():
        for p in _deferred:
            try:
                _real_unlink(p)
            except OSError:
                pass  # best effort; OS will reclaim temp eventually

    os.unlink = _safe_unlink
    atexit.register(_cleanup_deferred)
