"""Kill the configured recognizer if its Node service disappears (Linux only)."""
import ctypes
import os
import signal
import sys

expected_parent = int(sys.argv[1])
if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_PDEATHSIG failed")
if os.getppid() != expected_parent:
    sys.exit(1)
os.execv(sys.argv[2], sys.argv[2:])
