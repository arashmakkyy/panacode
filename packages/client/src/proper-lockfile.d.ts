declare module "proper-lockfile" {
  const lockfile: {
    lock(
      file: string,
      options: {
        realpath: boolean
        lockfilePath: string
        retries: { retries: number; factor: number; minTimeout: number; maxTimeout: number; randomize: boolean }
      },
    ): Promise<() => Promise<void>>
  }
  export default lockfile
}
