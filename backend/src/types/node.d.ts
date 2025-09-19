declare module 'node:http' {
  type IncomingMessage = any;
  type ServerResponse = any;
  type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
  function createServer(listener: RequestListener): {
    listen(port: number, callback?: () => void): void;
  };
  export { IncomingMessage, ServerResponse, RequestListener, createServer };
}

declare module 'node:crypto' {
  function randomBytes(size: number): { toString(encoding: string): string };
  function pbkdf2Sync(
    password: string,
    salt: string,
    iterations: number,
    keylen: number,
    digest: string
  ): { toString(encoding: string): string };
  function timingSafeEqual(a: any, b: any): boolean;
}

declare const Buffer: {
  from(data: string, encoding?: string): {
    toString(encoding?: string): string;
    length?: number;
  };
};

declare const process: {
  env: Record<string, string | undefined>;
};
