import { runSeedCli } from './seed-cli';

process.exit(await runSeedCli(process.argv.slice(2), process.env));
