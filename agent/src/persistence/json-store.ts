import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

export const defaultDataDirectory = resolve(process.cwd(), "src/persistence/data");

export class JsonRepositoryError extends Error {
  public constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "JsonRepositoryError";
  }
}

export interface JsonStoreOptions<T> {
  filename: string;
  schema: z.ZodType<T>;
  defaultValue: T;
  dataDirectory?: string | URL | undefined;
}

export interface RepositoryStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  update(mutator: (current: T) => T | Promise<T>): Promise<T>;
}

export class JsonStore<T> implements RepositoryStore<T> {
  private static readonly writeQueues = new Map<string, Promise<unknown>>();

  public readonly filePath: string;

  public constructor(private readonly options: JsonStoreOptions<T>) {
    const dataDirectory = options.dataDirectory
      ? options.dataDirectory.toString().startsWith("file:")
        ? new URL(options.dataDirectory).pathname
        : options.dataDirectory.toString()
      : defaultDataDirectory;

    this.filePath = join(dataDirectory, options.filename);
  }

  public async read(): Promise<T> {
    let raw: string;

    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.options.defaultValue;
      }

      throw new JsonRepositoryError(`Unable to read ${this.options.filename}`, error);
    }

    try {
      return this.options.schema.parse(JSON.parse(raw));
    } catch (error) {
      throw new JsonRepositoryError(
        `${this.options.filename} failed schema validation`,
        error
      );
    }
  }

  public async write(value: T): Promise<void> {
    const parsed = this.options.schema.parse(value);
    await mkdir(dirname(this.filePath), { recursive: true });

    const tmpPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  public async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      const current = await this.read();
      const next = await mutator(current);
      await this.write(next);
      return next;
    });
  }

  private async runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    const previous = JsonStore.writeQueues.get(this.filePath) ?? Promise.resolve();

    const next = previous.then(operation, operation);
    JsonStore.writeQueues.set(
      this.filePath,
      next.finally(() => {
        if (JsonStore.writeQueues.get(this.filePath) === next) {
          JsonStore.writeQueues.delete(this.filePath);
        }
      })
    );

    return next;
  }
}
