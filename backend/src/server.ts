import { Application } from './app';

const PORT = Number(process.env.PORT ?? 3001);

const app = new Application();
app.listen(PORT, () => {
  console.log(`Authentication API listening on port ${PORT}`);
});
