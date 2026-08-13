import { performHttpProxyHandshake } from '@fuman/net';
import { connectTcp, connectTls } from '@fuman/node';
import {
  type ITelegramConnection,
  IntermediatePacketCodec,
  type TelegramTransport,
} from '@mtcute/core';
import type { BasicDcOption } from '@mtcute/core/utils.js';
import type { ProxyEntry } from '@shared-types';
import { isProxyHost } from '@shared-types';

class TcpTransport implements TelegramTransport {
  connect(dc: BasicDcOption): Promise<ITelegramConnection> {
    return connectTcp({ address: dc.ipAddress, port: dc.port });
  }

  packetCodec(): IntermediatePacketCodec {
    return new IntermediatePacketCodec();
  }
}

class HttpProxyTcpTransport implements TelegramTransport {
  constructor(private readonly proxy: ProxyEntry) {}

  async connect(dc: BasicDcOption): Promise<ITelegramConnection> {
    const endpoint = { address: this.proxy.host, port: this.proxy.port };
    const conn =
      this.proxy.protocol === 'https' ? await connectTls(endpoint) : await connectTcp(endpoint);

    await performHttpProxyHandshake(
      conn,
      conn,
      {
        host: this.proxy.host,
        port: this.proxy.port,
        user: this.proxy.username,
        password: this.proxy.password,
      },
      { address: dc.ipAddress, port: dc.port },
    );
    return conn;
  }

  packetCodec(): IntermediatePacketCodec {
    return new IntermediatePacketCodec();
  }
}

export const transportFor = (proxy?: ProxyEntry | null): TelegramTransport => {
  if (!proxy) return new TcpTransport();
  // Checked here rather than left to DNS: a host that cannot resolve makes the connection retry forever.
  if (!isProxyHost(proxy.host)) {
    throw new Error(`Некорректный хост прокси: ${proxy.host}`);
  }
  return new HttpProxyTcpTransport(proxy);
};
