#!/usr/bin/env python3
"""Local development gateway: NuttX uORB -> HTTP -> watch QuickApp.
No synthetic samples and no gRPC readback are used as the data source.
"""
import argparse
import collections
import json
import math
import re
import signal
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

LINE = re.compile(r"sensor_(accel|gyro)\(now:\d+\):timestamp:(\d+),x:([^,]+),y:([^,]+),z:([^,\s]+)")

def parse_frame(line):
    match = LINE.search(line)
    if not match:
        return None
    kind, stamp, x, y, z = match.groups()
    values = [float(x), float(y), float(z)]
    if not all(math.isfinite(v) for v in values):
        return None
    return dict(kind=kind, timestampMs=int(stamp) / 1000, x=values[0], y=values[1], z=values[2])

class Stream:
    def __init__(self):
        self.lock = threading.Lock()
        self.frames = collections.deque(maxlen=512)
        self.sequence = 0
        self.session = str(uuid.uuid4())
        self.latest = {}
        self.counts = collections.Counter()
        self.error = ''

    def ingest(self, line):
        try:
            frame = parse_frame(line)
        except (ValueError, OverflowError):
            return
        if frame is None:
            return
        with self.lock:
            self.sequence += 1
            frame['sequence'] = self.sequence
            self.frames.append(frame)
            self.latest[frame['kind']] = time.monotonic()
            self.counts[frame['kind']] += 1

    def packet(self, after):
        with self.lock:
            # The first request starts at the current tail; historical frames
            # must not make a new session appear to have live sensors.
            frames = [] if after < 0 else [f for f in self.frames if f['sequence'] > after]
            error = self.error
            if after >= 0 and self.frames and after < self.frames[0]['sequence'] - 1:
                error = 'emulator_bridge_overflow'
            if any(time.monotonic() - t > 1 for t in self.latest.values()):
                error = 'emulator_native_stream_stale'
            return dict(protocol=1, source='emulator_uorb', units='m/s2,rad/s',
                        session=self.session, cursor=self.sequence, frames=frames, error=error)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not re.fullmatch(r'emulator-\d+', args.serial):
        parser.error('This gateway is for an emulator only; use the native Feature on hardware.')
    stream = Stream()
    # NuttX getopt requires options BEFORE the topic filter.
    command = ['adb', '-s', args.serial, 'shell',
               'uorb_listener -r 50 -t 3600 sensor_accel0,sensor_gyro0']
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, bufsize=1)
    def collect():
        for line in child.stdout:
            stream.ingest(line)
        with stream.lock:
            stream.error = 'emulator_native_listener_exited'
    threading.Thread(target=collect, daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            target = urlsplit(self.path)
            if target.path != '/v1/imu':
                self.send_error(404); return
            try:
                after = int(parse_qs(target.query).get('after', ['-1'])[0])
            except ValueError:
                self.send_error(400); return
            data = json.dumps(stream.packet(after), separators=(',', ':'), allow_nan=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers(); self.wfile.write(data)
        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    print(json.dumps({'listening': f'127.0.0.1:{args.port}', 'source': command[-1]}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        child.terminate()
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
        print(json.dumps({'received': dict(stream.counts), 'last_sequence': stream.sequence}), flush=True)

if __name__ == '__main__':
    main()
