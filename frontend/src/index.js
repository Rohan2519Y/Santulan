import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/fonts.css';
import './index.css';
import App from './App';
import { applyPreferences } from './services/preferences';
import reportWebVitals from './reportWebVitals';

applyPreferences();
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
