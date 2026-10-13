# Generate a realistic docx (styles.xml + rels + settings) for docx-preview testing
import io, os, zipfile
base = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(base, '_docs')
os.makedirs(d, exist_ok=True)

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="word/styles.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="word/settings.xml"/>
</Relationships>'''

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="DengXian" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1" w:default="0"><w:name w:val="heading 1"/>
<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1F3864"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2" w:default="0"><w:name w:val="heading 2"/>
<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="2E5395"/></w:rPr></w:style>
</w:styles>'''

SETTINGS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'''

def para(text, style=None, bold=False):
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    rpr = '<w:rPr><w:b/></w:rPr>' if bold else ''
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'

body = (
    para('项目评审会议纪要', 'Heading1') +
    para('时间：2026 年 10 月 12 日 · 地点：3 号楼会议室') +
    para('一、晾衣绳文档卡验收', 'Heading2') +
    para('确认文档拖入晾衣绳后以类型化板式卡呈现，悬停直接展开阅读，PDF 由 PDF.js 渲染，Word 由 docx-preview 渲染。') +
    para('二、横向滚动验收', 'Heading2') +
    para('挂满一屏后保持自然间距，滚轮与横向拖拽均可平移，卡片沿绳的垂曲线滑动。') +
    para('三、待办事项') +
    para('1. 修正 Word 渲染的页边距与字体回退；') +
    para('2. 信标展开动效打磨；') +
    para('3. 全量回归后发版。')
)
DOC = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
       f'<w:body>{body}'
       '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
       '</w:body></w:document>')

p = os.path.join(d, '项目评审纪要.docx')
with zipfile.ZipFile(p, 'w') as w:
    w.writestr('[Content_Types].xml', CT)
    w.writestr('_rels/.rels', RELS)
    w.writestr('word/document.xml', DOC)
    w.writestr('word/styles.xml', STYLES)
    w.writestr('word/settings.xml', SETTINGS)
print(p, os.path.getsize(p), 'bytes')
