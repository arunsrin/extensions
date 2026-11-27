"""Create a clean Chrome Web Store upload zip in dist/ containing only runtime files."""
import json
import os
import zipfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INCLUDE_DIRS = ("icons", "src")
INCLUDE_FILES = ("manifest.json",)


def main():
    with open(os.path.join(ROOT, "manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)

    version = manifest.get("version", "0.0.0")
    dist_dir = os.path.join(ROOT, "dist")
    os.makedirs(dist_dir, exist_ok=True)
    zip_path = os.path.join(dist_dir, f"time-ledger-v{version}.zip")

    written = []
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in INCLUDE_FILES:
            abs_path = os.path.join(ROOT, rel)
            zf.write(abs_path, rel)
            written.append(rel)

        for folder in INCLUDE_DIRS:
            base = os.path.join(ROOT, folder)
            for dirpath, _, filenames in os.walk(base):
                for fname in sorted(filenames):
                    abs_path = os.path.join(dirpath, fname)
                    rel_path = os.path.relpath(abs_path, ROOT).replace(os.sep, "/")
                    zf.write(abs_path, rel_path)
                    written.append(rel_path)

    size_kb = os.path.getsize(zip_path) / 1024.0
    print(f"Created {zip_path} ({size_kb:.1f} KB, {len(written)} files)")


if __name__ == "__main__":
    main()
