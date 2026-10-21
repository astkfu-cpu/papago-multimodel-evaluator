// Plugin archives only. This format is deliberately different from official sheet results.
export const BACKUP_SCHEMA='papago_pairwise_assistant_backup/v1';
const resultFields=['translation','rendering','translation_reason','rendering_reason','source_summary','a_evidence','b_evidence','a_state','b_state','confidence','needs_review','review_reason','archiveId','model','ruleVersion','requestId','refined','cached','formatRetries','imageInfo'];
const rowFields=['id','schema','createdAt','updatedAt','sheetId','evaluator','scope','pairId','index','total','languagePair','pageURL','images','applied'];
const text=(v,max=2400)=>typeof v==='string' && v.length<=max;
export function cleanRecord(row) {
  if(!row || typeof row!=='object' || !text(row.id,200) || !row.id || row.schema!=='papago_pairwise_assistant_record/v1')throw new Error('归档记录 ID 或版本无效');
  for(const name of ['sheetId','evaluator','pairId','languagePair','pageURL'])if(!text(row[name]))throw new Error('归档缺少 '+name);
  for(const name of ['createdAt','updatedAt'])if(!text(row[name],60) || !Number.isFinite(Date.parse(row[name])))throw new Error('归档时间无效');
  if(!Array.isArray(row.scope) || row.scope.length>20 || row.scope.some(x=>!text(x,40)))throw new Error('归档语言范围无效');
  if(!Number.isInteger(row.index) || !Number.isInteger(row.total) || row.index<1 || row.total<row.index || typeof row.applied!=='boolean')throw new Error('归档题号或保存状态无效');
  if(!Array.isArray(row.images) || row.images.length>3)throw new Error('归档图片信息无效');
  const images=row.images.map(x=>{
    if(!['src','a','b'].includes(x.side) || !text(x.url,6000))throw new Error('归档图片链接无效');
    const url=new URL(x.url);if(url.protocol!=='file:')throw new Error('归档只接受本地图片链接');
    for(const k of ['width','height','rotation'])if(k in x && (typeof x[k]!=='number' || !Number.isFinite(x[k]) || x[k]<0))throw new Error('图片尺寸或旋转信息无效');
    return Object.fromEntries(['side','url','width','height','rotation'].filter(k=>k in x).map(k=>[k,x[k]]));
  });
  const r=row.result;
  if(!r || !['A','tie','B',null].includes(r.translation) || !['A','tie','B',null].includes(r.rendering) || typeof r.confidence!=='number' || !Number.isFinite(r.confidence) || r.confidence<0 || r.confidence>1 || typeof r.needs_review!=='boolean')throw new Error('归档评价字段无效');
  for(const name of ['translation_reason','rendering_reason','source_summary','a_evidence','b_evidence','review_reason'])if(!text(r[name],10000))throw new Error('归档理由字段无效：'+name);
  if(!['normal','no_result','untranslated','broken_unreadable','uncertain'].includes(r.a_state) || !['normal','no_result','untranslated','broken_unreadable','uncertain'].includes(r.b_state))throw new Error('归档结果状态无效');
  for(const k of ['archiveId','model','ruleVersion','requestId'])if(k in r && !text(r[k]))throw new Error('归档元数据无效：'+k);
  for(const k of ['refined','cached'])if(k in r && typeof r[k]!=='boolean')throw new Error('归档元数据无效：'+k);
  if('formatRetries' in r && (!Number.isInteger(r.formatRetries) || r.formatRetries<0))throw new Error('格式恢复次数无效');
  if(r.imageInfo && (!Array.isArray(r.imageInfo) || r.imageInfo.length>20 || r.imageInfo.some(x=>!text(x.label,200) || ['width','height','originalWidth','originalHeight'].some(k=>k in x && (typeof x[k]!=='number' || !Number.isFinite(x[k]) || x[k]<0)))))throw new Error('归档图片元数据无效');
  const result=Object.fromEntries(resultFields.filter(k=>k in r && k!=='imageInfo').map(k=>[k,r[k]]));
  if(r.imageInfo)result.imageInfo=r.imageInfo.map(x=>Object.fromEntries(['label','width','height','originalWidth','originalHeight'].filter(k=>k in x).map(k=>[k,x[k]])));
  result.archiveId=row.id;
  return {...Object.fromEntries(rowFields.map(k=>[k,row[k]])),images,result};
}
export function backupOf(rows,version) {
  return {schema:BACKUP_SCHEMA,extensionVersion:version,exportedAt:new Date().toISOString(),records:rows.map(cleanRecord)};
}
export function parseBackup(value) {
  if(value?.schema!==BACKUP_SCHEMA || !Array.isArray(value.records) || value.records.length>10000)throw new Error('这不是插件归档备份 v1；不要导入客户正式结果 JSON');
  const rows=value.records.map(cleanRecord),ids=new Set();
  for(const row of rows){if(ids.has(row.id))throw new Error('备份文件含重复记录 ID，请分别导入原始分批文件');ids.add(row.id);}
  return rows;
}
export function matchesFilter(row,filter={}) {
  if(filter.sheetId && row.sheetId!==filter.sheetId || filter.evaluator && row.evaluator!==filter.evaluator)return false;
  if(filter.from && row.createdAt<filter.from || filter.to && row.createdAt>=filter.to)return false;
  return true;
}
