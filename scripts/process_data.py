import pandas as pd
import re
import os
import sys
import warnings

# Suppress specific warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning, module='pandas')

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
    
    # 1. Filter out RAW images (ORF, CR2, etc)
    mask_raw = df['Name'].str.contains(r'\.(?:ORF|CR2|NEF|ARW)$', case=False, regex=True, na=False)
    df = df[~mask_raw].copy()

    # 2. Convert Drive links to Thumbnail links
    def make_thumb(url):
        if pd.isna(url): return ""
        return re.sub(r"https://drive.google.com/file/d/(.*)/view\?usp=drivesdk", 
                      r"https://drive.google.com/thumbnail?id=\1&sz=w2000", str(url))

    df['URL_to_view'] = df['URL'].apply(make_thumb)
    
    # 3. Extract CAM_ID (Loose Strategy: "CAM" followed by digits)
    df['CAM_ID'] = df['Name'].str.extract(r'(CAM\d+)', flags=re.IGNORECASE)
    
    return df

def process_photos_list(photo_df):
    # Group ALL photos by CAM_ID into a list of dicts
    return photo_df.groupby('CAM_ID')[['URL_to_view', 'Name']].apply(
        lambda x: x.to_dict('records'), 
        include_groups=False
    ).reset_index(name='all_photos')

def merge_data(df, photo_lookup):
    df = pd.merge(df, photo_lookup, on='CAM_ID', how='left')
    
    # Helper to populate legacy columns (URLd, URLv) for standard display
    def extract_dv(row):
        d, v = None, None
        if isinstance(row['all_photos'], list):
            for p in row['all_photos']:
                name = str(p['Name']).lower()
                if 'd.jpg' in name and not d: d = p['URL_to_view']
                if 'v.jpg' in name and not v: v = p['URL_to_view']
        return pd.Series([d, v])

    df[['URLd', 'URLv']] = df.apply(extract_dv, axis=1)
    return df

def clean_dates(series):
    return pd.to_datetime(series, errors='coerce', dayfirst=True).dt.strftime('%d/%b/%Y')

def process_collection(df):
    print("Processing Collection Data...")
    
    # Handle mixed date formats
    date_cols = [c for c in df.columns if 'date' in c.lower()]
    for col in date_cols:
        df[col] = clean_dates(df[col])

    # --- FIX: Create the formatted date column expected by Vue ---
    if 'Preservation_date' in df.columns:
        df['Preservation_date_formatted'] = df['Preservation_date']
    # -------------------------------------------------------------

    # Logic: if CAM_ID_insectary exists, use it
    if 'CAM_ID_insectary' in df.columns:
        df['CAM_ID'] = df.apply(
            lambda row: row['CAM_ID_insectary'] if pd.notna(row['CAM_ID_insectary']) and row['CAM_ID_insectary'] != "NA" else row['CAM_ID'], 
            axis=1
        )

    df = df.rename(columns={'SPECIES': 'Species'})
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
    
    # Taxonomy Split
    def split_species(row):
        full_s = str(row.get('SPECIES', ''))
        parts = full_s.split()
        genus = parts[0] if len(parts) > 0 else ""
        species_part = parts[1] if len(parts) > 1 else ""
        sub_part = " ".join(parts[2:]) if len(parts) > 2 else None
        return pd.Series([f"{genus} {species_part}", sub_part if sub_part else "None"])

    if 'SPECIES' in df.columns:
        df[['Species', 'Subspecies_Form']] = df.apply(split_species, axis=1)

    if 'Preservation_date' in df.columns:
        df['Preservation_date_formatted'] = clean_dates(df['Preservation_date'])
        
    return df

def process_crispr(df):
    print("Processing CRISPR Data...")
    if 'Emerge_date' in df.columns:
        df['Preservation_date'] = df['Emerge_date']
        df['Preservation_date_formatted'] = clean_dates(df['Emerge_date'])
        
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

    # 1. Process Photos
    photos_df = process_photo_links(raw_photos)
    photo_lookup = process_photos_list(photos_df)
    
    # 2. Process Sheets & Merge Photos
    collection = merge_data(process_collection(raw_collection), photo_lookup)
    insectary = merge_data(process_insectary(raw_insectary), photo_lookup)
    crispr = merge_data(process_crispr(raw_crispr), photo_lookup)

    # 3. Save JSONs
    collection.to_json(f"{OUTPUT_DIR}/collection.json", orient='records')
    insectary.to_json(f"{OUTPUT_DIR}/insectary.json", orient='records')
    crispr.to_json(f"{OUTPUT_DIR}/crispr.json", orient='records')

    print(f"Success! Data saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()