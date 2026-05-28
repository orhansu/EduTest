import json

path = r"c:\Users\orhan\Desktop\Projects\EduTest\folders\inputs\Yüksek Lisans\Mobil ve Kablosuz Ağlar\Test-Final\test3.json"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace all occurrences of four backslashes with two backslashes
new_content = content.replace("\\\\", "\\")

# Verify that the new content parses as valid JSON
try:
    json.loads(new_content)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Success: File successfully updated and validated as JSON.")
except Exception as e:
    print(f"Error parsing JSON: {e}")
