	const http = require("node:http");

	const host = process.env.HOST || "127.0.0.1";
	const port = Number(process.env.PORT || 3000);
	const esp32ApiUrl = process.env.ESP32_API_URL || "http://192.168.4.1";

	function sendJson(response, statusCode, payload) {
		response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
		response.end(JSON.stringify(payload));
	}

	async function readJsonBody(request) {
		const chunks = [];
		let totalBytes = 0;

		for await (const chunk of request) {
			totalBytes += chunk.length;
			if (totalBytes > 1024) {
				const error = new Error("Request body is too large");
				error.statusCode = 413;
				throw error;
			}
			chunks.push(chunk);
		}

		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			const error = new Error("Request body must be valid JSON");
			error.statusCode = 400;
			throw error;
		}
	}

	async function forwardToEsp32(request, response, path, body) {
		try {
			const upstreamResponse = await fetch(new URL(path, esp32ApiUrl), {
				method: request.method,
				headers: body ? { "content-type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
			const responseBody = await upstreamResponse.text();
			response.writeHead(upstreamResponse.status, {
				"content-type": upstreamResponse.headers.get("content-type") || "application/json",
			});
			response.end(responseBody);
		} catch {
			sendJson(response, 502, { error: "Cannot reach ESP32. Connect this computer to its setup Wi-Fi." });
		}
	}

	const server = http.createServer(async (request, response) => {
		const path = new URL(request.url, "http://localhost").pathname;

		if (request.method === "GET" && path === "/api/wifi/status") {
			await forwardToEsp32(request, response, path);
			return;
		}

		if (request.method === "POST" && path === "/api/wifi/connect") {
			let body;
			try {
				body = await readJsonBody(request);
			} catch (error) {
				sendJson(response, error.statusCode || 400, { error: error.message });
				return;
			}

			const ssidBytes = typeof body.ssid === "string" ? Buffer.byteLength(body.ssid, "utf8") : 0;
			const passwordBytes = typeof body.password === "string" ? Buffer.byteLength(body.password, "utf8") : 0;
			if (ssidBytes < 1 || ssidBytes > 32 || passwordBytes > 63) {
				sendJson(response, 400, { error: "SSID must be 1-32 bytes and password must be 0-63 bytes" });
				return;
			}

			await forwardToEsp32(request, response, path, body);
			return;
		}

		sendJson(response, 404, { error: "Not found" });
	});

	server.listen(port, host, () => {
		console.log(`Wi-Fi API listening at http://${host}:${port}`);
	});
    