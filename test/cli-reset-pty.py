# Test-only terminal driver; production reset still requires a real interactive TTY.
import os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = b''
choice = confirmation = False
deadline = time.monotonic() + 120
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            output += data
            if not choice and b'[keep/remove/cancel]' in output:
                choice = True
                os.write(master, (os.environ.get('VHOSTRA_TEST_RESET_CHOICE', 'keep') + '\n').encode())
            if not confirmation and b'to confirm:' in output:
                confirmation = True
                os.write(master, (os.environ.get('VHOSTRA_TEST_RESET_CONFIRM', 'Yes, Reset Vhostra') + '\n').encode())
        elif child.poll() is not None:
            break
    if child.poll() is None:
        child.terminate()
    code = child.wait(timeout=10)
    sys.stdout.buffer.write(output)
    sys.exit(code)
finally:
    os.close(master)
