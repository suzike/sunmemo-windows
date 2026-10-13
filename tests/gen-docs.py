# Generate test docs: sample.md, sample.pdf (PIL), minimal sample.docx (zip)
import io, os, zipfile
from PIL import Image, ImageDraw

base = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(base, '_docs')
os.makedirs(d, exist_ok=True)

md = os.path.join(d, '项目方案.md')
io.open(md, 'w', encoding='utf-8').write(
    '# 项目方案\n\n## 背景与目标\n\n这是一个用于验证文档卡的 **Markdown 示例文档**。\n\n'
    '- [ ] 第一项待办\n- [x] 已完成的一项\n- 普通列表项\n\n> 引用：晾在绳上的文档，随手可读。\n\n'
    '正文段落：支持 **加粗**、*斜体*、`行内代码` 与 ~~删除线~~。\n\n### 小节\n\n更多正文内容用来测试滚动阅读的体验。\n' * 3)

# PDF: two-page colourful PDF via PIL
pages = []
for k, color in enumerate([(70, 130, 180), (176, 96, 40)]):
    im = Image.new('RGB', (960, 720), (250, 248, 244))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 960, 160], fill=color)
    dr.ellipse([380, 40, 460, 120], fill=(255, 214, 90))
    dr.text((60, 200), f'SunMemo sample PDF - page {k+1}', fill=(50, 50, 55))
    for i in range(8):
        dr.line([60, 280 + i * 42, 900, 280 + i * 42], fill=(190, 186, 178), width=3)
    pages.append(im.convert('RGB'))
pages[0].save(os.path.join(d, '设计说明.pdf'), save_all=True, append_images=pages[1:])

# minimal docx
def zf(w, name, data):
    w.writestr(name, data)
docx_path = os.path.join(d, '会议纪要.docx')
with zipfile.ZipFile(docx_path, 'w') as w:
    zf(w, '[Content_Types].xml',
       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
       '<Default Extension="xml" ContentType="application/xml"/>'
       '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
       '</Types>')
    zf(w, '_rels/.rels',
       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
       '</Relationships>')
    zf(w, 'word/document.xml',
       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
       '<w:body>'
       '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>会议纪要</w:t></w:r></w:p>'
       '<w:p><w:r><w:t>第一项：晾衣绳文档卡验收，悬停直接展开阅读。</w:t></w:r></w:p>' * 6 +
       '<w:p><w:r><w:t>第二项：横向滚动与拖拽平移体验确认。</w:t></w:r></w:p>'
       '</w:body></w:document>')

for p in [md, os.path.join(d, '设计说明.pdf'), docx_path]:
    print(os.path.basename(p), os.path.getsize(p), 'bytes')
