import os

MODULES_DIR = "modules"
OUTPUT_FILE = "final_prompt.txt"

def build():
    if not os.path.exists(MODULES_DIR):
        print(f"Error: {MODULES_DIR} directory not found.")
        return

    # Sadece .txt ile biten ve başlıkta '#' vb ignore işareti olmayan dosyaları al
    files = sorted([f for f in os.listdir(MODULES_DIR) if f.endswith(".txt") and not f.startswith("_") and not f.startswith("#")])
    
    if not files:
        print("No valid module files found in " + MODULES_DIR)
        return

    print("Building prompt from modules:")
    content_chunks = []
    
    for filename in files:
        filepath = os.path.join(MODULES_DIR, filename)
        print(f" - Adding {filename}")
        with open(filepath, 'r', encoding='utf-8') as f:
            content_chunks.append(f.read().strip())
            
    final_content = "\n\n".join(content_chunks)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(final_content)
        
    print(f"\nSuccess! Built {OUTPUT_FILE} completely.")

if __name__ == "__main__":
    build()
