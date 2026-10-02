"""Drive one test-only CLI confirmation or hidden-password prompt in a real TTY."""
import os
import pty
import select
import subprocess
import sys
import time

needle = os.environ['VHOSTRA_TEST_PROMPT'].encode()
answer = os.environ['VHOSTRA_TEST_ANSWER'].encode() + b'\n'
master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = b''
sent = False
deadline = time.monotonic() + 900
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if not sent and needle in output:
                sent = True
                os.write(master, answer)
        elif child.poll() is not None:
            break
    if child.poll() is None:
        child.terminate()
    code = child.wait(timeout=10)
    sys.stdout.buffer.write(output)
    sys.exit(code if sent else 1)
finally:
    os.close(master)
