import os
import json
from http.server import SimpleHTTPRequestHandler, HTTPServer
import urllib.parse

STATUS_DIR = "../folders/status"

class MyServer(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Override to properly serve /folders/ which is outside the app/ directory
        if path.startswith('/folders/'):
            path = urllib.parse.unquote(path)
            return os.path.abspath(os.path.join(os.getcwd(), '..', path.lstrip('/')))
        return super().translate_path(path)

    def end_headers(self):
        # Arama motorları veya cache mekanizmaları statik dosyaları eski versiyonundan okumasın diye:
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            statuses = {}
            if os.path.exists(STATUS_DIR):
                for filename in os.listdir(STATUS_DIR):
                    if filename.endswith(".json"):
                        filepath = os.path.join(STATUS_DIR, filename)
                        try:
                            with open(filepath, 'r', encoding='utf-8') as f:
                                test_id = filename.replace('.json', '')
                                statuses[test_id] = json.load(f)
                        except Exception as e:
                            print(f"Error reading {filename}: {e}")
            
            self.wfile.write(json.dumps(statuses).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/status':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                test_id = data.get('test_id')
                if test_id:
                    if not os.path.exists(STATUS_DIR):
                        os.makedirs(STATUS_DIR)
                    
                    filepath = os.path.join(STATUS_DIR, f"{test_id}.json")
                    with open(filepath, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': True}).encode('utf-8'))
                else:
                    self.send_response(400)
                    self.end_headers()
            except Exception as e:
                print(f"Error writing status: {e}")
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    port = 5050
    print(f"Starting API Server on port {port}...")
    print(f"Server allows reading static files and saving to '/status' folder via /api/status endpoint.")
    server = HTTPServer(('192.168.1.52', port), MyServer)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
    print("\nServer stopped.")
