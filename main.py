import imaplib
import json
import poplib
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import index.html


HOST = "127.0.0.1"
PORT = 8000


HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Email Server Connection Test</title>
	<style>
		:root {
			--bg: #111317;
			--panel: #1a1e24;
			--text: #e7ecf2;
			--muted: #9ca9b8;
			--accent: #59c3c3;
			--error: #ff6b6b;
			--ok: #43d17a;
			--border: #2a3039;
			--input: #141920;
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			min-height: 100vh;
			background: radial-gradient(circle at top right, #1b2430 0%, var(--bg) 55%);
			color: var(--text);
			font: 15px/1.45 "Segoe UI", Tahoma, sans-serif;
			display: grid;
			place-items: center;
			padding: 20px;
		}

		.card {
			width: 100%;
			max-width: 480px;
			background: linear-gradient(180deg, #1e232b 0%, var(--panel) 100%);
			border: 1px solid var(--border);
			border-radius: 14px;
			padding: 22px;
			box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
		}

		h1 {
			margin: 0 0 8px;
			font-size: 20px;
			font-weight: 650;
			letter-spacing: 0.2px;
		}

		.subtitle {
			margin: 0 0 20px;
			color: var(--muted);
			font-size: 13px;
		}

		form {
			display: grid;
			gap: 12px;
		}

		.field {
			display: grid;
			gap: 6px;
		}

		label {
			font-size: 13px;
			color: #cfd8e3;
		}

		input,
		select,
		button {
			width: 100%;
			border-radius: 10px;
			border: 1px solid var(--border);
			background: var(--input);
			color: var(--text);
			padding: 10px 12px;
			outline: none;
			font-size: 14px;
		}

		input:focus,
		select:focus {
			border-color: var(--accent);
			box-shadow: 0 0 0 2px rgba(89, 195, 195, 0.15);
		}

		.grid-2 {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 12px;
		}

		button {
			border: none;
			cursor: pointer;
			font-weight: 600;
			background: linear-gradient(135deg, #59c3c3, #3e9f9f);
			color: #071015;
			transition: filter 0.15s ease;
			margin-top: 4px;
		}

		button:hover {
			filter: brightness(1.05);
		}

		button:disabled {
			opacity: 0.7;
			cursor: not-allowed;
			filter: grayscale(0.15);
		}

		.inline-error {
			min-height: 18px;
			color: var(--error);
			font-size: 13px;
			margin-top: -2px;
		}

		.status {
			margin-top: 12px;
			border-radius: 10px;
			padding: 10px 12px;
			font-size: 14px;
			display: none;
			border: 1px solid transparent;
		}

		.status.ok {
			display: block;
			color: var(--ok);
			border-color: rgba(67, 209, 122, 0.4);
			background: rgba(67, 209, 122, 0.08);
		}

		.status.err {
			display: block;
			color: #ff9e9e;
			border-color: rgba(255, 107, 107, 0.4);
			background: rgba(255, 107, 107, 0.08);
		}

		@media (max-width: 520px) {
			.card {
				padding: 18px;
			}

			.grid-2 {
				grid-template-columns: 1fr;
			}
		}
	</style>
</head>
<body>
	<section class="card">
		<h1>Email Server Connection</h1>
		<p class="subtitle">Enter your mail server settings and run a quick connection test.</p>

		<form id="connectionForm" novalidate>
			<div class="field">
				<label for="host">Host / server address</label>
				<input id="host" name="host" type="text" autocomplete="off" />
			</div>

			<div class="grid-2">
				<div class="field">
					<label for="port">Port</label>
					<input id="port" name="port" type="number" value="993" min="1" max="65535" />
				</div>

				<div class="field">
					<label for="protocol">Protocol</label>
					<select id="protocol" name="protocol">
						<option value="IMAP">IMAP</option>
						<option value="POP3">POP3</option>
					</select>
				</div>
			</div>

			<div class="field">
				<label for="username">Username / email</label>
				<input id="username" name="username" type="text" autocomplete="username" />
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input id="password" name="password" type="password" autocomplete="current-password" />
			</div>

			<p class="inline-error" id="inlineError"></p>
			<button id="connectBtn" type="submit">Connect</button>
		</form>

		<div id="status" class="status" role="status" aria-live="polite"></div>
	</section>

	<script>
		const form = document.getElementById('connectionForm');
		const inlineError = document.getElementById('inlineError');
		const statusEl = document.getElementById('status');
		const connectBtn = document.getElementById('connectBtn');

		function showStatus(message, ok) {
			statusEl.textContent = message;
			statusEl.className = ok ? 'status ok' : 'status err';
		}

		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			inlineError.textContent = '';
			statusEl.className = 'status';
			statusEl.textContent = '';

			const payload = {
				host: document.getElementById('host').value.trim(),
				port: document.getElementById('port').value.trim(),
				username: document.getElementById('username').value.trim(),
				password: document.getElementById('password').value,
				protocol: document.getElementById('protocol').value
			};

			if (!payload.host || !payload.port || !payload.username || !payload.password || !payload.protocol) {
				inlineError.textContent = 'Please complete all fields before connecting.';
				return;
			}

			connectBtn.disabled = true;
			connectBtn.textContent = 'Connecting...';

			try {
				const response = await fetch('/connect', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});

				const data = await response.json();
				showStatus(data.message || 'Unknown response from server.', !!data.ok);
			} catch (error) {
				showStatus('Request failed. Make sure the local server is running.', false);
			} finally {
				connectBtn.disabled = false;
				connectBtn.textContent = 'Connect';
			}
		});
	</script>
</body>
</html>
"""


def validate_payload(payload):
		required = ["host", "port", "username", "password", "protocol"]
		for key in required:
				value = payload.get(key)
				if value is None or str(value).strip() == "":
						return False, f"Field '{key}' is required."

		try:
				port = int(payload["port"])
				if not (1 <= port <= 65535):
						return False, "Port must be between 1 and 65535."
		except (TypeError, ValueError):
				return False, "Port must be a valid number."

		protocol = str(payload["protocol"]).upper()
		if protocol not in {"IMAP", "POP3"}:
				return False, "Protocol must be IMAP or POP3."

		payload["port"] = port
		payload["protocol"] = protocol
		return True, ""


def test_connection(host, port, username, password, protocol):
		timeout = 12
		socket.setdefaulttimeout(timeout)

		if protocol == "IMAP":
				client = None
				try:
						# 143 is usually plain IMAP; 993 is usually IMAP over SSL.
						client = imaplib.IMAP4(host, port) if port == 143 else imaplib.IMAP4_SSL(host, port)
						client.login(username, password)
						client.logout()
						return True, "Connection successful via IMAP."
				except Exception as exc:
						try:
								if client is not None:
										client.logout()
						except Exception:
								pass
						return False, f"IMAP connection failed: {exc}"

		if protocol == "POP3":
				client = None
				try:
						# 110 is usually plain POP3; 995 is usually POP3 over SSL.
						client = poplib.POP3(host, port) if port == 110 else poplib.POP3_SSL(host, port)
						client.user(username)
						client.pass_(password)
						client.quit()
						return True, "Connection successful via POP3."
				except Exception as exc:
						try:
								if client is not None:
										client.quit()
						except Exception:
								pass
						return False, f"POP3 connection failed: {exc}"

		return False, "Unsupported protocol."


class EmailConnectionHandler(BaseHTTPRequestHandler):
		def _send_json(self, status_code, payload):
				data = json.dumps(payload).encode("utf-8")
				self.send_response(status_code)
				self.send_header("Content-Type", "application/json; charset=utf-8")
				self.send_header("Content-Length", str(len(data)))
				self.end_headers()
				self.wfile.write(data)

		def _send_html(self, html):
				data = html.encode("utf-8")
				self.send_response(200)
				self.send_header("Content-Type", "text/html; charset=utf-8")
				self.send_header("Content-Length", str(len(data)))
				self.end_headers()
				self.wfile.write(data)

		def log_message(self, fmt, *args):
				# Keep console output concise.
				return

		def do_GET(self):
				if self.path in {"/", "/index.html"}:
						self._send_html(HTML_PAGE)
						return

				self.send_error(404, "Not Found")

		def do_POST(self):
				if self.path != "/connect":
						self.send_error(404, "Not Found")
						return

				try:
						length = int(self.headers.get("Content-Length", "0"))
						raw = self.rfile.read(length)
						payload = json.loads(raw.decode("utf-8"))
				except Exception:
						self._send_json(400, {"ok": False, "message": "Invalid JSON request."})
						return

				valid, error_msg = validate_payload(payload)
				if not valid:
						self._send_json(400, {"ok": False, "message": error_msg})
						return

				ok, message = test_connection(
						payload["host"],
						payload["port"],
						payload["username"],
						payload["password"],
						payload["protocol"],
				)
				status = 200 if ok else 400
				self._send_json(status, {"ok": ok, "message": message})


if __name__ == "__main__":
		server = ThreadingHTTPServer((HOST, PORT), EmailConnectionHandler)
		print(f"Server running on http://{HOST}:{PORT}")
		try:
				server.serve_forever()
		except KeyboardInterrupt:
				print("\nShutting down...")
		finally:
				server.server_close()

