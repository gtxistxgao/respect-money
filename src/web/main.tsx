import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './features/overview/overview.css';
import { App } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
