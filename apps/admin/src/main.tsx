import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@dafeiyu/shared/tokens.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Admin root element is missing');

createRoot(root).render(<StrictMode><BrowserRouter basename="/admin"><App /></BrowserRouter></StrictMode>);
