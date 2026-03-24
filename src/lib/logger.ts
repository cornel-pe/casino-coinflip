import log, { config, tag } from '@slackgram/logger';


const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const minLevel = (process.env.MB_LOG_LEVEL || (env === 'development' ? 'debug' : 'info')) as
  | 'debug'
  | 'info'
  | 'warn'
  | 'error';

config({
  env,
  minLevel,
  debug: env === 'development',
  colors: env === 'development',
});

export const httpLog = tag('HTTP/COINFLIP');


export { log };

