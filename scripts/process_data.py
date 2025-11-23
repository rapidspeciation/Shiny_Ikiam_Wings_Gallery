import pandas as pd
import re
import os
import sys
import warnings

# --- WARNING MANAGEMENT ---
# 1. Ignore "Could not infer format", falling back to slow parsing (Expected due to mixed data)
warnings.filterwarnings("ignore", message="Could not infer format")
# 2. Ignore "Parsing dates in %Y-%m-%d format when dayfirst=True" 
# (Expected: We have mixed ISO and Day-Month-Year columns, both are valid)
warnings.filterwarnings("ignore", message="Parsing dates in")
# 3. Ignore general pandas clutter
warnings.filterwarnings("ignore", category=UserWarning, module='pandas')
warnings.filterwarnings("ignore", category=FutureWarning, module='pandas')

# --- CONFIGURATION ---
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

def format_all_date_columns(df):
    """
    Scans for any column with 'date' or 'DATE' in the name.
    Converts mixed formats (DD-Mon-YY, YYYY-MM-DD) into a clean DD/Mon/YYYY string.
    Garbage inputs (#xxx!, etc.) become null.
    """
    date_cols = [c for c in df.columns if 'date' in c.lower()]
    
    for col in date_cols:
        # errors='coerce' turns "#xxx!" into NaT (Not a Time)
        # dayfirst=True ensures 01/02/23 is treated as Feb 1st (not Jan 2nd)
        # format='mixed' allows strict ISO and DD-Mon-YY to coexist
        dt_series = pd.to_datetime(df[col], errors='coerce', dayfirst=True, format='mixed')
        
        # Create the formatted version for the UI
        df[f'{col}_formatted'] = dt_series.dt.strftime('%d/%b/%Y')
        
    return df

def process_photo_links(df):
    print("Processing Photo Links...")
    
    # 1. Vectorized Filter: Remove RAW images (.ORF, .CR2, .NEF, .ARW)
    # The audit showed thousands of CR2/ORF files. We must filter them.
    mask_raw = df['Name'].str.contains(r'\.(?:ORF|CR2|NEF|ARW)$', case=False, regex=True, na=False)
    df = df[~mask_raw].copy()

    # 2. Vectorized Link Replacement (Optimization)
    df['URL_to_view'] = df['URL'].str.replace(
        r"https://drive.google.com/file/d/(.*)/view\?usp=drivesdk", 
        r"https://drive.google.com/thumbnail?id=\1&sz=w2000", 
        regex=True
    )
    
    # 3. Extract CAM_ID
    df['CAM_ID'] = df['Name'].str.extract(r'(CAM\d+)', flags=re.IGNORECASE)
    
    return df

def get_photo_lookup(photo_df):
    """Groups photos by CAM_ID."""
    return photo_df.groupby('CAM_ID')[['URL_to_view', 'Name']].apply(
        lambda x: x.to_dict('records'), 
        include_groups=False
    ).reset_index(name='all_photos')

def merge_photos(df, photo_lookup):
    """Merges photo lists and creates legacy URLd/URLv columns."""
    df = pd.merge(df, photo_lookup, on='CAM_ID', how='left')
    
    # Extract D/V for the grid view
    def extract_legacy_cols(row):
        d, v = None, None
        if isinstance(row['all_photos'], list):
            for p in row['all_photos']:
                name = str(p['Name']).lower()
                if 'd.jpg' in name and not d: d = p['URL_to_view']
                if 'v.jpg' in name and not v: v = p['URL_to_view']
        return pd.Series([d, v])

    df[['URLd', 'URLv']] = df.apply(extract_legacy_cols, axis=1)
    return df

def process_collection(df):
    print("Processing Collection Data...")
    
    # 1. Format ALL dates (Collection_date, Death_date, Preservation_date, etc.)
    df = format_all_date_columns(df)

    # 2. Standardize Columns
    df = df.rename(columns={'SPECIES': 'Species'})
    df['ID_status'] = df['ID_status'].fillna("NA")
    
    return df

def process_insectary(df):
    print("Processing Insectary Data...")
    
    # 1. Filter invalid rows
    df = df[ (df['CAM_ID'].notna()) & (df['CAM_ID'] != "") & (df['CAM_ID'] != "NA") ].copy()
    
    # 2. Handle ID Overwrite 
    # (Audit confirmed 6 rows have different IDs in CollData)
    if 'CAM_ID_CollData' in df.columns:
         mask = (df['CAM_ID_CollData'].notna()) & (df['CAM_ID_CollData'] != "NA")
         df.loc[mask, 'CAM_ID'] = df.loc[mask, 'CAM_ID_CollData']
    
    # 3. Vectorized Species Split
    # Audit confirmed format is "Genus Species Subspecies" (e.g., Melinaea mothone mothone)
    if 'SPECIES' in df.columns:
        split_data = df['SPECIES'].str.split(n=2, expand=True)
        
        # Safely assign parts even if some rows are missing parts
        genus = split_data[0] if 0 in split_data.columns else ""
        species_part = split_data[1] if 1 in split_data.columns else ""
        subsp_part = split_data[2] if 2 in split_data.columns else None
        
        df['Species'] = genus + " " + species_part
        df['Subspecies_Form'] = subsp_part.fillna("None")

    # 4. Format ALL dates
    df = format_all_date_columns(df)
        
    return df

def process_crispr(df):
    print("Processing CRISPR Data...")
    
    # 1. Map Emerge_date to Preservation_date
    if 'Emerge_date' in df.columns:
        df['Preservation_date'] = df['Emerge_date']
        
    # 2. Format ALL dates
    df = format_all_date_columns(df)
        
    df['Mutant'] = df['Mutant'].fillna("NA")
    return df

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        # Load Raw CSVs (dtype=str ensures IDs like "007" aren't parsed as 7)
        raw_photos = pd.read_csv(get_export_url(SHEET_GIDS["Photo_links"]), dtype=str)
        raw_collection = pd.read_csv(get_export_url(SHEET_GIDS["Collection_data"]), dtype=str)
        raw_crispr = pd.read_csv(get_export_url(SHEET_GIDS["CRISPR"]), dtype=str)
        raw_insectary = pd.read_csv(get_export_url(SHEET_GIDS["Insectary_data"]), dtype=str)
    except Exception as e:
        print(f"Error downloading data: {e}")
        sys.exit(1)

    # Processing Pipeline
    photos_df = process_photo_links(raw_photos)
    photo_lookup = get_photo_lookup(photos_df)
    
    collection = merge_photos(process_collection(raw_collection), photo_lookup)
    insectary = merge_photos(process_insectary(raw_insectary), photo_lookup)
    crispr = merge_photos(process_crispr(raw_crispr), photo_lookup)

    # Save Results
    collection.to_json(f"{OUTPUT_DIR}/collection.json", orient='records')
    insectary.to_json(f"{OUTPUT_DIR}/insectary.json", orient='records')
    crispr.to_json(f"{OUTPUT_DIR}/crispr.json", orient='records')

    print(f"Success! Database updated in {OUTPUT_DIR}")

if __name__ == "__main__":
    main()