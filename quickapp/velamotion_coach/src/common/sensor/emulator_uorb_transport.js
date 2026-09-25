// Development transport only: consumes the simulator's native uORB stream.
// It never reads gRPC getSensor or generates motion samples.
export class EmulatorUorbTransport {
  constructor(deps) {
    const d = deps || {};
    this.fetcher = d.fetcher || null;
    this.baseUrl = 'http://10.0.2.2:8765/v1/imu';
    this.setTimer = d.setTimeout || setTimeout;
    this.clearTimer = d.clearTimeout || clearTimeout;
    this.generation = 0;
    this.timer = null;
    this.deadline = null;
  }
  getCapabilities() {
    return { accelerometer: true, gyroscope: true, fullActivityRecognition: true,
      mode: 'emulator_six_axis', source: 'emulator_uorb', reason: '' };
  }
  start(onFrame, onError) {
    this.stop();
    const generation = ++this.generation;
    let cursor = -1; let session = null;
    let fetcher = this.fetcher;
    if (!fetcher) {
      try { const mod = require('@system.fetch'); fetcher = mod.default || mod; }
      catch (e) { onError('emulator_bridge_fetch_unavailable'); return; }
    }
    const active = () => generation === this.generation;
    const fail = (reason) => { if (active()) { this.stop(); onError(reason); } };
    const poll = () => {
      if (!active()) return;
      this.timer = null;
      let settled = false;
      this.deadline = this.setTimer(() => { settled = true; fail('emulator_bridge_timeout'); }, 1500);
      const finish = () => {
        if (settled || !active()) return false;
        settled = true;
        this.clearTimer(this.deadline); this.deadline = null;
        return true;
      };
      try {
        fetcher.fetch({ url: this.baseUrl + '?after=' + cursor, method: 'GET', responseType: 'text',
          success: (response) => {
            if (!finish()) return;
            try {
              if (response.code !== 200) throw new Error('emulator_bridge_http_' + response.code);
              const packet = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
              if (!packet || packet.protocol !== 1 || packet.source !== 'emulator_uorb' ||
                  packet.units !== 'm/s2,rad/s' || typeof packet.session !== 'string' || !packet.session ||
                  !Number.isSafeInteger(packet.cursor) || packet.cursor < 0 || !Array.isArray(packet.frames) || packet.frames.length > 512) {
                throw new Error('emulator_bridge_protocol_invalid');
              }
              if (session && session !== packet.session) throw new Error('emulator_bridge_restarted');
              session = packet.session;
              if (packet.error) throw new Error(packet.error);
              packet.frames.forEach((frame) => {
                if (!frame || !Number.isSafeInteger(frame.sequence) ||
                    (frame.kind !== 'accel' && frame.kind !== 'gyro')) throw new Error('emulator_bridge_frame_invalid');
                if (frame.sequence <= cursor) return;
                if (cursor >= 0 && frame.sequence !== cursor + 1) throw new Error('emulator_bridge_sequence_gap');
                cursor = frame.sequence;
                if (active()) onFrame(frame.kind, frame);
              });
              if (cursor >= 0 && packet.cursor !== cursor) throw new Error('emulator_bridge_cursor_invalid');
              cursor = packet.cursor;
              if (active()) this.timer = this.setTimer(poll, 100);
            } catch (e) { fail(e.message || 'emulator_bridge_invalid'); }
          },
          fail: () => { if (finish()) fail('emulator_bridge_unreachable'); },
        });
      } catch (e) { if (finish()) fail('emulator_bridge_fetch_failed'); }
    };
    poll();
  }
  stop() {
    this.generation += 1;
    if (this.timer !== null) this.clearTimer(this.timer);
    if (this.deadline !== null) this.clearTimer(this.deadline);
    this.timer = null; this.deadline = null;
  }
}
