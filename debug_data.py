import pandas as pd
import re

# Load raw CSVs directly (bypass process_data for a moment to check raw inputs)
# We use the IDs from your script
base_url = "https://docs.google.com/spreadsheets/d/1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4/export?format=csv&gid="
photos = pd.read_csv(base_url + "439406691") # Photo_links
crispr = pd.read_csv(base_url + "952436162") # CRISPR

print(f"Raw CRISPR Rows: {len(crispr)}")
print(f"Raw Photo Rows: {len(photos)}")

# 1. Replicate Regex Logic
# This matches "CAM12345" only if followed by "d.JPG" or "v.JPG"
photos['CAM_ID_Strict'] = photos['Name'].str.extract(r'(.*)(?=[dv]\.JPG)')
unique_strict = photos['CAM_ID_Strict'].dropna().unique()
print(f"Unique IDs (Strict d/v match): {len(unique_strict)}")

# 2. Check CRISPR Matches
# We merge CRISPR data with the IDs found in photos
crispr['Has_Photo'] = crispr['CAM_ID'].isin(unique_strict)
print(f"CRISPR rows matching strict photos: {crispr['Has_Photo'].sum()}")

# 3. Check for 'polymnia' specifically
poly = crispr[crispr['Stock_of_origin'].str.contains("polymnia", case=False, na=False)]
print(f"Mechanitis polymnia in Data: {len(poly)}")
print(f"Mechanitis polymnia with Photos: {poly['Has_Photo'].sum()}")