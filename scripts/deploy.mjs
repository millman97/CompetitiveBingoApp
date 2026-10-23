import { deploy } from './lib/deployment.mjs';

try {
  await deploy(process.env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
