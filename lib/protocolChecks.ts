import { Checker, type CheckerOptions, type CheckInfo } from 'livekit-client';

const TEST_DURATION = 10_000;

interface ProtocolStats {
  protocol: 'udp' | 'tcp';
  packetsLost: number;
  packetsSent: number;
  qualityLimitationDurations: Record<string, number>;
  rttTotal: number;
  jitterTotal: number;
  bitrateTotal: number;
  count: number;
}

abstract class SingleProtocolCheck extends Checker {
  protected abstract readonly protocol: 'udp' | 'tcp';
  protected stats?: ProtocolStats;

  getInfo(): CheckInfo {
    const info = super.getInfo();
    info.data = this.stats;
    return info;
  }

  async perform(): Promise<void> {
    await this.connect();
    await this.switchProtocol(this.protocol);

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    let hue = 0;
    const animate = () => {
      hue = (hue + 1) % 360;
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(animate);
    };
    animate();

    const stream = canvas.captureStream(30);
    const videoTrack = stream.getVideoTracks()[0];

    const pub = await this.room.localParticipant.publishTrack(videoTrack, {
      simulcast: false,
      degradationPreference: 'maintain-resolution',
      videoEncoding: { maxBitrate: 2_000_000 },
    });
    const track = pub!.track!;

    const protocolStats: ProtocolStats = {
      protocol: this.protocol,
      packetsLost: 0,
      packetsSent: 0,
      qualityLimitationDurations: {},
      rttTotal: 0,
      jitterTotal: 0,
      bitrateTotal: 0,
      count: 0,
    };

    const interval = setInterval(async () => {
      const stats = await track.getRTCStatsReport();
      stats?.forEach((stat: Record<string, unknown>) => {
        if (stat.type === 'outbound-rtp') {
          protocolStats.packetsSent = stat.packetsSent as number;
          protocolStats.qualityLimitationDurations =
            stat.qualityLimitationDurations as Record<string, number>;
          protocolStats.bitrateTotal += stat.targetBitrate as number;
          protocolStats.count++;
        } else if (stat.type === 'remote-inbound-rtp') {
          protocolStats.packetsLost = stat.packetsLost as number;
          protocolStats.rttTotal += stat.roundTripTime as number;
          protocolStats.jitterTotal += stat.jitter as number;
        }
      });
    }, 1000);

    await new Promise((resolve) => setTimeout(resolve, TEST_DURATION));
    clearInterval(interval);
    videoTrack.stop();
    canvas.remove();
    this.stats = protocolStats;

    if (protocolStats.count > 0) {
      this.appendMessage(
        `upstream bitrate: ${(protocolStats.bitrateTotal / protocolStats.count / 1_000_000).toFixed(2)} mbps`,
      );
      this.appendMessage(
        `RTT: ${((protocolStats.rttTotal / protocolStats.count) * 1000).toFixed(2)} ms`,
      );
      this.appendMessage(
        `jitter: ${((protocolStats.jitterTotal / protocolStats.count) * 1000).toFixed(2)} ms`,
      );
    }

    if (protocolStats.packetsLost > 0) {
      this.appendWarning(
        `packets lost: ${((protocolStats.packetsLost / protocolStats.packetsSent) * 100).toFixed(2)}%`,
      );
    }
    if (protocolStats.qualityLimitationDurations.bandwidth > 1) {
      this.appendWarning(
        `bandwidth limited ${((protocolStats.qualityLimitationDurations.bandwidth / (TEST_DURATION / 1000)) * 100).toFixed(2)}%`,
      );
    }
    if (protocolStats.qualityLimitationDurations.cpu > 0) {
      this.appendWarning(
        `cpu limited ${((protocolStats.qualityLimitationDurations.cpu / (TEST_DURATION / 1000)) * 100).toFixed(2)}%`,
      );
    }
  }
}

export class UDPConnectionCheck extends SingleProtocolCheck {
  protected readonly protocol = 'udp' as const;

  get description() {
    return 'Connection quality via UDP';
  }

  constructor(url: string, token: string, options?: CheckerOptions) {
    super(url, token, options);
    this.name = 'UDPConnectionCheck';
  }
}

export class TCPConnectionCheck extends SingleProtocolCheck {
  protected readonly protocol = 'tcp' as const;

  get description() {
    return 'Connection quality via TCP';
  }

  constructor(url: string, token: string, options?: CheckerOptions) {
    super(url, token, options);
    this.name = 'TCPConnectionCheck';
  }
}
