#!/usr/bin/env python3
import sys
sys.dont_write_bytecode = True
import unittest
from unittest.mock import patch
from emulator_uorb_bridge import Stream, parse_frame

class BridgeTest(unittest.TestCase):
    def line(self, stamp=1234567, kind='gyro', x='.125'):
        return f'sensor_{kind}(now:1234999):timestamp:{stamp},x:{x},y:-.75,z:1.25,temperature:nan'
    def test_parser_keeps_si_floats_and_monotonic_milliseconds(self):
        f = parse_frame(self.line())
        self.assertEqual(f, dict(kind='gyro',timestampMs=1234.567,x=.125,y=-.75,z=1.25))
    def test_unrelated_and_nonfinite_axis_are_rejected(self):
        self.assertIsNone(parse_frame('system log'))
        for value in ('nan','inf','-inf'):
            self.assertIsNone(parse_frame(self.line(x=value)))
        s=Stream();s.ingest(self.line(x='invalid'));self.assertEqual(s.sequence,0)
    def test_new_client_does_not_replay_history(self):
        s=Stream();s.ingest(self.line());p=s.packet(-1)
        self.assertEqual(p['frames'],[]);self.assertEqual(p['cursor'],1)
        s.ingest(self.line(1254567,'accel'));p=s.packet(1)
        self.assertEqual(len(p['frames']),1);self.assertEqual(p['frames'][0]['kind'],'accel')
    def test_overflow_is_reported_and_ring_is_bounded(self):
        s=Stream()
        for i in range(514):s.ingest(self.line(i*20000))
        self.assertEqual(len(s.frames),512);self.assertEqual(s.packet(0)['error'],'emulator_bridge_overflow')
    def test_one_axis_stale_invalidates_packet(self):
        s=Stream()
        with patch('emulator_uorb_bridge.time.monotonic',return_value=10):
            s.ingest(self.line());s.ingest(self.line(kind='accel'))
        with patch('emulator_uorb_bridge.time.monotonic',return_value=11.1):
            s.ingest(self.line(kind='accel'))
            self.assertEqual(s.packet(2)['error'],'emulator_native_stream_stale')
    def test_listener_exit_is_never_masked_by_old_samples(self):
        s=Stream();s.ingest(self.line());s.error='emulator_native_listener_exited'
        self.assertEqual(s.packet(-1)['error'],'emulator_native_listener_exited')

if __name__=='__main__':unittest.main()
