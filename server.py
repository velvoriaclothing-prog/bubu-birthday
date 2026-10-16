import os
import sys
import json
import base64
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 55096
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
MANIFEST_PATH = os.path.join(BASE_DIR, "media-manifest.json")

class BirthdayHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/upload-photo":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                filename = data.get("filename", "")
                base64_data = data.get("data", "")
                caption = data.get("caption", "My love 💗")
                album = data.get("album", "moments")
                favorite = bool(data.get("favorite", False))

                if not filename or not base64_data:
                    self._send_json({"error": "Missing filename or image data"}, 400)
                    return

                # Clean filename
                clean_name = os.path.basename(filename).replace(" ", "_")
                if not clean_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
                    clean_name += ".jpg"

                # Ensure unique filename
                target_path = os.path.join(BASE_DIR, clean_name)
                counter = 1
                base_part, ext = os.path.splitext(clean_name)
                while os.path.exists(target_path):
                    clean_name = f"{base_part}_{counter}{ext}"
                    target_path = os.path.join(BASE_DIR, clean_name)
                    counter += 1

                # Decode and save file
                if "," in base64_data:
                    base64_data = base64_data.split(",", 1)[1]
                file_bytes = base64.b64decode(base64_data)
                with open(target_path, "wb") as f:
                    f.write(file_bytes)

                # Update media-manifest.json
                with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                    manifest = json.load(f)

                new_photo = {
                    "file": clean_name,
                    "favorite": favorite,
                    "featured": False,
                    "album": album,
                    "caption": caption
                }
                manifest["photos"].insert(0, new_photo)

                with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=2, ensure_ascii=False)

                print(f"[API] Added photo: {clean_name} ({len(file_bytes)} bytes)")
                self._send_json({"success": True, "photo": new_photo, "message": f"Photo {clean_name} added successfully!"})
            except Exception as e:
                print(f"[API ERROR] Upload failed: {e}")
                self._send_json({"error": str(e)}, 500)
            return

        elif self.path == "/api/delete-photo":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                file_to_delete = data.get("file", "")

                if not file_to_delete:
                    self._send_json({"error": "Missing file name to delete"}, 400)
                    return

                # Update media-manifest.json
                with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                    manifest = json.load(f)

                original_count = len(manifest["photos"])
                manifest["photos"] = [p for p in manifest["photos"] if p.get("file") != file_to_delete]
                removed = original_count - len(manifest["photos"])

                with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=2, ensure_ascii=False)

                # Permanently delete file from disk if requested
                file_path = os.path.join(BASE_DIR, file_to_delete)
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        print(f"[API] Removed file from disk: {file_to_delete}")
                    except Exception as err:
                        print(f"[API WARNING] Could not remove file from disk: {err}")

                print(f"[API] Deleted photo {file_to_delete} (removed {removed} entries)")
                self._send_json({"success": True, "file": file_to_delete, "removed": removed})
            except Exception as e:
                print(f"[API ERROR] Delete failed: {e}")
                self._send_json({"error": str(e)}, 500)
            return

        super().do_POST()

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), BirthdayHandler)
    print(f"Birthday server with Photo Management API listening on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
