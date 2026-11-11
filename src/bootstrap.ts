import { app } from 'electron';

const userData = process.env.MUSICAPP_USER_DATA;

if (userData) {
  app.setPath('userData', userData);
}
