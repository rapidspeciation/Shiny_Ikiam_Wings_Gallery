import pandas as pd
import re
import os
import sys

# --- Configuration ---
SHEET_ID = "1QZj6YgHAJ9NmFXFPCtu-i-1NDuDmAdMF2Wogts7S2_4"
SHEET_GIDS = {
    "Collection_data": "900206579",
    "Photo_links": "439406691",
    "CRISPR": "952436162",
    "Insectary_data": "402580526"
}

OUTPUT_DIR = "public/data"

def get_export_url(gid):
    return f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}"

def process_photo_links(df):
    print("Processing Photo Links...")
    # Convert Drive links to Thumbnail links
    df['URL_to_view'] = df['URL'].apply(
        lambda x: re.sub(r"https://drive.google.com/file/d/(.*)/view\?usp=drivesdk",
                         r"https://drive.google.com/thumbnail?id=\1&sz=w2000", str(x))
    )
    # Extract CAM_ID
    df['CAM_ID'] = df['Name'].str.extract(r'(.*)(?=[dv]\.JPG)')
    return df

def get_side_links(photo_df, side_char):
    # Filter for 'd' or 'v' photos
    side_df = photo_df[photo_df['Name'].str.contains(f"{side_char}\.JPG", na=False)].copy()
    side_df = side_df[['CAM_ID', 'URL_to_view']]
    side_df = side_df.rename(columns={'URL_to_view': f'URL{side_char}'})
    return side_df

def merge_photos(df, dorsal, ventral):
    # Helper to merge photos into any dataframe based on CAM_ID
    df = pd.merge(df, dorsal, on='CAM_ID', how='left')
    df = pd.merge(df, ventral, on='CAM_ID', how='left')
    return df

def process_collection(df):
    print("Processing Collection Data...")
    date_cols = [c for c in df.columns if 'date' in c.lower()]
    for col in date_cols:
        df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%d-%b-%y')

    if 'CAM_ID_insectary' in df.columns:
        df['CAM_ID'] = df.apply(
            lambda row: row['CAM_ID_insectary'] if pd.notna(row['CAM_ID_insectary']) and row['CAM_ID_insectary'] != "NA" else row['CAM_ID'],
            axis=1
        )

    df = df.rename(columns={'SPECIES': 'Species'})
    if 'Preservation_date' in df.columns:
        df['Preservation_date_formatted'] = pd.to_datetime(df['Preservation_date'], errors='coerce').dt.strftime('%d/%b/%Y')

    df['ID_status'] = df['ID_status'].fillna("NA")
    return df

def process_insectary(df):
    print("Processing Insectary Data...")
    df = df[ (df['CAM_ID'] != "") & (df['CAM_ID'] != "NA") & (df['CAM_ID'].notna()) ].copy()

    if 'CAM_ID_CollData' in df.columns:
         df['CAM_ID'] = df.apply(
            lambda row: row['CAM_ID_CollData'] if pd.notna(row['CAM_ID_CollData']) and row['CAM_ID_CollData'] != "NA" else row['CAM_ID'],
            axis=1
        )

    # Split Taxonomy
    def split_species(row):
        full_s = str(row.get('SPECIES', ''))
        parts = full_s.split()
        genus = parts[0] if len(parts) > 0 else ""
        species_part = parts[1] if len(parts) > 1 else ""
        sub_part = " ".join(parts[2:]) if len(parts) > 2 else None
        return pd.Series([f"{genus} {species_part}", sub_part if sub_part else "None"])

    if 'SPECIES' in df.columns:
        df[['Species', 'Subspecies_Form']] = df.apply(split_species, axis=1)

    # Format date
    if 'Preservation_date' in df.columns:
        df['Preservation_date_formatted'] = pd.to_datetime(df['Preservation_date'], errors='coerce').dt.strftime('%d/%b/%Y')

    return df

def process_crispr(df):
    print("Processing CRISPR Data...")
    if 'Emerge_date' in df.columns:
        df['Preservation_date'] = df['Emerge_date'] # Use Emerge date as sort key
        df['Preservation_date_formatted'] = pd.to_datetime(df['Emerge_date'], errors='coerce').dt.strftime('%d/%b/%Y')

    df['Mutant'] = df['Mutant'].fillna("NA")
    return df

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        raw_photos = pd.read_csv(get_export_url(SHEET_GIDS["Photo_links"]), dtype=str)
        raw_collection = pd.read_csv(get_export_url(SHEET_GIDS["Collection_data"]), dtype=str)
        raw_crispr = pd.read_csv(get_export_url(SHEET_GIDS["CRISPR"]), dtype=str)
        raw_insectary = pd.read_csv(get_export_url(SHEET_GIDS["Insectary_data"]), dtype=str)
    except Exception as e:
        print(f"Error downloading data: {e}")
        sys.exit(1)

    # 1. Prepare Photos
    photos = process_photo_links(raw_photos)
    dorsal_links = get_side_links(photos, 'd')
    ventral_links = get_side_links(photos, 'v')

    # 2. Process & Merge
    # Collection
    collection = process_collection(raw_collection)
    collection = merge_photos(collection, dorsal_links, ventral_links)

    # Insectary
    insectary = process_insectary(raw_insectary)
    insectary = merge_photos(insectary, dorsal_links, ventral_links)

    # CRISPR
    crispr = process_crispr(raw_crispr)
    crispr = merge_photos(crispr, dorsal_links, ventral_links)

    # 3. Save
    collection.to_json(f"{OUTPUT_DIR}/collection.json", orient='records')
    insectary.to_json(f"{OUTPUT_DIR}/insectary.json", orient='records')
    crispr.to_json(f"{OUTPUT_DIR}/crispr.json", orient='records')

    print(f"Success! Data saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
