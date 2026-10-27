"""Compare only scoped candidate cases with a retained accepted capture, with zero tolerance."""
import argparse, importlib.util, json, os
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('reference',type=Path);parser.add_argument('candidate',type=Path);parser.add_argument('output',type=Path)
a=parser.parse_args();repo=Path(os.environ.get('PARITY_REPO_ROOT',str(Path.cwd())))
spec=importlib.util.spec_from_file_location('parity_compare',repo/'app/document-qa/frontend/migration-parity/compare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
reference,candidate,output=a.reference.resolve(),a.candidate.resolve(),a.output.resolve()
assert output not in [reference,candidate] and reference not in output.parents and candidate not in output.parents
refs={v['name']:v for v in json.loads((reference/'capture-index.json').read_text())['cases']};cases=json.loads((candidate/'capture-index.json').read_text())['cases'];rows=[]
for c in cases:
 name=c['name'];assert Path(name).name==name
 before=reference/'screenshots'/f'{name}.png';after=candidate/'screenshots'/f'{name}.png'
 assert m.digest(before)==refs[name]['screenshotSha256'],name
 assert m.digest(after)==c['screenshotSha256'],name
 row={'name':name,'reference_sha256':m.digest(before),'candidate_sha256':m.digest(after)};row.update(m.compare_images(before,after,output/'differences'/f'{name}.png'));rows.append(row)
counts={status:sum(row['status']==status for row in rows)for status in ['identical','pixels-differ','dimensions-differ','missing']};output.mkdir(parents=True,exist_ok=True)
report={'reference':str(reference),'reference_index_sha256':m.digest(reference/'capture-index.json'),'candidate':str(candidate),'pixel_tolerance':0,'masks':[],'counts':counts,'cases':rows};(output/'comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(counts)
raise SystemExit(0 if counts['identical']==len(rows)else 1)
