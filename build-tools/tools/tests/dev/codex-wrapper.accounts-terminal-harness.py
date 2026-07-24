import errno
import os
import pty
import select
import signal
import sys
import time

launcher = os.environ["VBR_TEST_TERMINAL_LAUNCHER"]
responses = os.environ["VBR_TEST_TERMINAL_RESPONSES"].split()
child_pid, master_fd = pty.fork()

if child_pid == 0:
    os.execv(launcher, [launcher])


def stop_child() -> None:
    try:
        os.killpg(child_pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    grace_deadline = time.monotonic() + 1
    while time.monotonic() < grace_deadline:
        exited, _status = os.waitpid(child_pid, os.WNOHANG)
        if exited:
            return
        time.sleep(0.02)
    try:
        os.killpg(child_pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    os.waitpid(child_pid, 0)


def terminate(_signum: int, _frame: object) -> None:
    stop_child()
    os._exit(124)


signal.signal(signal.SIGINT, terminate)
signal.signal(signal.SIGTERM, terminate)
timeout_seconds = float(os.environ.get("VBR_TEST_TERMINAL_TIMEOUT_SECONDS", "30"))
deadline = time.monotonic() + timeout_seconds
pending = b""
status = None

try:
    while status is None:
        if time.monotonic() >= deadline:
            stop_child()
            sys.exit(124)
        ready, _, _ = select.select([master_fd], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            if chunk:
                os.write(sys.stdout.fileno(), chunk)
                pending += chunk
                if responses and b"[y/N]" in pending:
                    os.write(master_fd, (responses.pop(0) + "\n").encode())
                    pending = b""
            else:
                _, status = os.waitpid(child_pid, 0)
                break
        exited, child_status = os.waitpid(child_pid, os.WNOHANG)
        if exited:
            status = child_status
finally:
    os.close(master_fd)

if responses:
    sys.stderr.write("PTY command exited before consuming all confirmation responses\n")
    sys.exit(125)
sys.exit(os.waitstatus_to_exitcode(status))
