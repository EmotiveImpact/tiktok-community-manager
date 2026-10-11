"""Linux parent-death guard for the bounded FFmpeg child; no shell is involved."""
import ctypes
import os
import signal
import sys

parent = int(sys.argv[1])
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != parent:
    sys.exit(1)
os.execv(sys.argv[2], sys.argv[2:])
