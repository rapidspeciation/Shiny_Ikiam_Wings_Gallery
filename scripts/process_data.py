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
    """
    Equivalent to creating URL_to_view and extracting CAM_ID in R.
    """
    print("Processing Photo Links...")
    # 1. Convert Drive links to Thumbnail links
    # Regex: Replace /view?usp=drivesdk with thumbnail link
    df['URL_to_view'] = df['URL'].apply(
        lambda x: re.sub(r"https://drive.google.com/file/d/(.*)/view\?usp=drivesdk", 
                         r"https://drive.google.com/thumbnail?id=\1&sz=w2000", str(x))
    )
    
    # 2. Extract CAM_ID (everything before d.JPG or v.JPG)
    df['CAM_ID'] = df['Name'].str.extract(r'(.*)(?=[dv]\.JPG)')
    return df

def get_side_links(photo_df, side_char):
    """
    Filters for 'd' or 'v' photos and prepares for merge.
    """
    # Filter by name containing side char (e.g., "d.JPG")
    side_df = photo_df[photo_df['Name'].str.contains(f"{side_char}\.JPG", na=False)].copy()
    side_df = side_df[['CAM_ID', 'URL_to_view']]
    side_df = side_df.rename(columns={'URL_to_view': f'URL{side_char}'})
    return side_df

def process_collection(df, dorsal, ventral):
    print("Processing Collection Data...")
    # Handle dates
    date_cols = [c for c in df.columns if 'date' in c.lower()]
    for col in date_cols:
        df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%d-%b-%y')

    # Priority for Insectary ID
    if 'CAM_ID_insectary' in df.columns:
        df['CAM_ID'] = df.apply(
            lambda row: row['CAM_ID_insectary'] if pd.notna(row['CAM_ID_insectary']) and row['CAM_ID_insectary'] != "NA" else row['CAM_ID'], 
            axis=1
        )

    # Join Photos
    df = pd.merge(df, dorsal, on='CAM_ID', how='left')
    df = pd.merge(df, ventral, on='CAM_ID', how='left')

    # Formatting
    df = df.rename(columns={'SPECIES': 'Species'})
    if 'Preservation_date' in df.columns:
        df['Preservation_date_formatted'] = pd.to_datetime(df['Preservation_date'], errors='coerce').dt.strftime('%d/%b/%Y')
    
    df['ID_status'] = df['ID_status'].fillna("NA")
    return df

def process_insectary(df):
    print("Processing Insectary Data...")
    df = df[ (df['CAM_ID'] != "") & (df['CAM_ID'] != "NA") & (df['CAM_ID'].notna()) ].copy()
    
    # Logic: if CAM_ID_CollData exists, use it
    if 'CAM_ID_CollData' in df.columns:
         df['CAM_ID'] = df.apply(
            lambda row: row['CAM_ID_CollData'] if pd.notna(row['CAM_ID_CollData']) and row['CAM_ID_CollData'] != "NA" else row['CAM_ID'], 
            axis=1
        )

    # Splitting Taxonomy: Genus Species Subspecies
    # R logic: separate(SPECIES, into = c("Genus", "Species_part", "Subspecies_part")...)
    
    def split_species(row):
        full_s = str(row.get('SPECIES', ''))
        parts = full_s.split()
        genus = parts[0] if len(parts) > 0 else ""
        species_part = parts[1] if len(parts) > 1 else ""
        sub_part = " ".join(parts[2:]) if len(parts) > 2 else None
        
        return pd.Series([f"{genus} {species_part}", sub_part if sub_part else "None"])

    if 'SPECIES' in df.columns:
        df[['Species', 'Subspecies_Form']] = df.apply(split_species, axis=1)
        
    return df

def process_crispr(df):
    print("Processing CRISPR Data...")
    if 'Emerge_date' in df.columns:
        df['Preservation_date'] = df['Emerge_date']
        # Format date for display
        df['Emerge_date_fmt'] = pd.to_datetime(df['Emerge_date'], errors='coerce').dt.strftime('%d/%b/%Y')
        
    df['Mutant'] = df['Mutant'].fillna("NA")
    return df

def main():
    # 1. Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 2. Download and Load Raw Data
    try:
        raw_photos = pd.read_csv(get_export_url(SHEET_GIDS["Photo_links"]), dtype=str)
        raw_collection = pd.read_csv(get_export_url(SHEET_GIDS["Collection_data"]), dtype=str)
        raw_crispr = pd.read_csv(get_export_url(SHEET_GIDS["CRISPR"]), dtype=str)
        raw_insectary = pd.read_csv(get_export_url(SHEET_GIDS["Insectary_data"]), dtype=str)
    except Exception as e:
        print(f"Error downloading data: {e}")
        sys.exit(1)

    # 3. Process Photos First (needed for others)
    photos = process_photo_links(raw_photos)
    
    # Create lookup tables for Dorsal and Ventral
    dorsal_links = get_side_links(photos, 'd')
    ventral_links = get_side_links(photos, 'v')
    
    # Save full photo map for lookup (needed for CRISPR/Insectary multiple photos)
    # We group by CAM_ID to get lists of photos
    photo_lookup = photos.groupby('CAM_ID')[['Name', 'URL_to_view']].apply(
        lambda x: x.to_dict('records')
    ).reset_index(name='Photo_URLs')
    photo_lookup.to_json(f"{OUTPUT_DIR}/photo_lookup.json", orient='records')

    # 4. Process Individual Sheets
    collection = process_collection(raw_collection, dorsal_links, ventral_links)
    insectary = process_insectary(raw_insectary)
    crispr = process_crispr(raw_crispr)

    # 5. Merge Photo Lookups into Insectary/CRISPR 
    # (The R app calculates Photo URLs on the fly for these tabs, 
    # here we pre-calculate or save the map to join in frontend)
    # For simplicity, we will rely on the photo_lookup.json in the frontend 
    # or we can merge basic photos here if needed.
    
    # 6. Save outputs
    collection.to_json(f"{OUTPUT_DIR}/collection.json", orient='records')
    insectary.to_json(f"{OUTPUT_DIR}/insectary.json", orient='records')
    crispr.to_json(f"{OUTPUT_DIR}/crispr.json", orient='records')

    print(f"Success! Data saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
