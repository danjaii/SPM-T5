import type { UserReader } from "../../src/readers/userReader";

/** In-memory UserReader: a map of user id to full name. Unknown ids are simply absent, like the real one. */
export class FakeUserReader implements UserReader {
  constructor(private readonly names: Record<string, string> = {}) {}

  async namesOf(ids: string[]) {
    return new Map(ids.filter((id) => id in this.names).map((id) => [id, this.names[id]!] as const));
  }
}
