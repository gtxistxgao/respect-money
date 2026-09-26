import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default defineConfig((environment) => mergeConfig(typeof base === 'function' ? base(environment) : base, { server: { proxy: { '/api/': 'http://127.0.0.1:3101' } } }));
