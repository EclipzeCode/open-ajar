#!/usr/bin/env python3
"""
Converts the Open Ajar opportunities workbook (.xlsx) to the CSV the importer reads. Standard library only.

  python3 xlsx-to-csv.py ~/Downloads/open_ajar_opportunities.xlsx data/opportunities.csv
  python3 xlsx-to-csv.py ~/Downloads/new_export.xlsx data/opportunities-b2.csv --batch b2

Use --batch for every export after the first: row ids (row-001...) get renumbered between exports, so a batch label keeps them distinct.

Expected tabs: "Import" and "Recheck" (same columns), optionally "Sources & Notes" (id, title, official_url, apply_url, sheet),
which supplies each listing's direct apply_url. Adds a "group" column ("import" or "recheck") recording which tab a row came from.
"""
import csv, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1

def read_workbook(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = {}
    for sh in wb.find('m:sheets', NS):
        target = rels[sh.get('{%s}id' % NS['r'])].lstrip('/')
        target = target if target.startswith('xl/') else 'xl/' + target
        rows = []
        for row in ET.fromstring(z.read(target)).find('m:sheetData', NS):
            cells = {}
            for c in row:
                t, v = c.get('t'), c.find('m:v', NS)
                if t == 's' and v is not None: val = shared[int(v.text)]
                elif t == 'inlineStr': val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                else: val = v.text if v is not None else ''
                cells[col(c.get('r'))] = val
            rows.append([cells.get(i, '') for i in range(max(cells) + 1)] if cells else [])
        sheets[sh.get('name')] = rows
    return sheets

def table(rows):
    header = rows[0]
    return header, [dict(zip(header, r + [''] * (len(header) - len(r)))) for r in rows[1:] if any(r)]

def main(src, dest, batch=''):
    sheets = read_workbook(src)
    apply = {}
    if 'Sources & Notes' in sheets:
        _, notes = table(sheets['Sources & Notes'])
        apply = {n['id']: n.get('apply_url', '') for n in notes}
    header = None
    out = []
    for tab in ('Import', 'Recheck'):
        if tab not in sheets: continue
        h, rows = table(sheets[tab])
        header = header or h
        for r in rows:
            r['apply_url'] = apply.get(r['id'], '')
            r['group'] = tab.lower()
            r['batch'] = batch
            out.append(r)
    if not out: sys.exit('No "Import" or "Recheck" rows found.')
    fields = header + ['apply_url', 'group', 'batch']
    with open(dest, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader(); w.writerows(out)
    print(f'Wrote {len(out)} rows to {dest}')

if __name__ == '__main__':
    args = sys.argv[1:]
    batch = ''
    if '--batch' in args:
        i = args.index('--batch'); batch = args[i + 1]; del args[i:i + 2]
    if len(args) != 2: sys.exit(__doc__)
    main(args[0], args[1], batch)
