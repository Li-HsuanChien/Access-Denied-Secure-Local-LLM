"""Zero-tolerance candidate-to-candidate comparison using the unchanged repo comparator."""
import argparse, importlib.util, json, os
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('reference',type=Path);parser.add_argument('candidate',type=Path);parser.add_argument('output',type=Path)
a=parser.parse_args();repo=Path(os.environ.get('PARITY_REPO_ROOT',str(Path.cwd())))
spec=importlib.util.spec_from_file_location('parity_compare',repo/'app/document-qa/frontend/migration-parity/compare.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
reference,candidate,output=a.reference.resolve(),a.candidate.resolve(),a.output.resolve()
assert output not in [reference,candidate] and reference not in output.parents and candidate not in output.parents
index=json.loads((reference/'capture-index.json').read_text());rows=[]
for case in index['cases']:
 name=case['name'];assert Path(name).name==name
 before=reference/'screenshots'/f'{name}.png';after=candidate/'screenshots'/f'{name}.png'
 assert module.digest(before)==case['screenshotSha256'],name
 row={'name':name,'reference_sha256':module.digest(before),'candidate_sha256':module.digest(after)}
 row.update(module.compare_images(before,after,output/'differences'/f'{name}.png'));rows.append(row)
counts={status:sum(row['status']==status for row in rows)for status in ['identical','pixels-differ','dimensions-differ','missing']}
output.mkdir(parents=True,exist_ok=True)
report={'reference':str(reference),'reference_kind':'accepted candidate, not regenerated original','reference_index_sha256':module.digest(reference/'capture-index.json'),'candidate':str(candidate),'pixel_tolerance':0,'masks':[],'counts':counts,'cases':rows}
(output/'comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(counts)
raise SystemExit(0 if counts['identical']==len(rows)else 1)
