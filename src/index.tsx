import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import './index.scss';
import './mobile-overrides.scss';
import App from './app';
import { Provider } from './context';
import { AuthProvider } from './auth/AuthProvider';
import { bootstrapTelegram } from './telegram-bootstrap';

const renderApp = () => {
	createRoot(document.getElementById("root") as HTMLElement).render(
		<BrowserRouter>
			<Routes>
				<Route path="*" element={
					<AuthProvider>
						<Provider>
							<App />
							<ToastContainer position="top-center" theme="dark" />
						</Provider>
					</AuthProvider>
				} />
			</Routes>
		</BrowserRouter>
	);
};

// Try Telegram auth first; if it redirects, the new page reload mounts the app.
// If not in Telegram (or already has ?cert=), fall through to render immediately.
bootstrapTelegram().finally(renderApp);
