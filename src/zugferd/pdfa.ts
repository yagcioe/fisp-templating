import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import { escapeXml } from "./xml.ts";

export const FACTURX_FILENAME = "factur-x.xml";
const FX_NS = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";
const srgbProfile = await readFile(new URL("./sRGB-v4.icc", import.meta.url));

export interface FacturXMetadata {
  title: string;
  author: string;
  subject: string;
  /** fx:ConformanceLevel, e.g. "EN 16931" */
  conformanceLevel: string;
  /** Tool that laid out the document (Info /Creator, xmp:CreatorTool) */
  creator: string;
}


const fxProperty = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;

function xmp(meta: FacturXMetadata, producer: string, date: string): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escapeXml(meta.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.subject)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${escapeXml(producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${escapeXml(meta.creator)}</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
      <xmp:MetadataDate>${date}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="${FX_NS}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${escapeXml(meta.conformanceLevel)}</fx:ConformanceLevel>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FX_NS}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProperty("DocumentFileName", "The name of the embedded XML document")}${fxProperty("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER")}${fxProperty("Version", "The actual version of the standard applying to the embedded XML document")}${fxProperty("ConformanceLevel", "The conformance level of the embedded XML document")}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Returns the filespec of an existing factur-x.xml attachment (normalizing its name), if any. */
function findAttachment(doc: PDFDocument): PDFRef | undefined {
  const names = doc.catalog
    .lookupMaybe(PDFName.of("Names"), PDFDict)
    ?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)
    ?.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!names) return undefined;
  for (let i = 0; i < names.size(); i += 2) {
    const name = names.lookup(i, PDFString, PDFHexString).decodeText();
    // typst resolves the path relative to its temp main file, e.g. "tmp/factur-x.xml".
    if (name === FACTURX_FILENAME || name.endsWith(`/${FACTURX_FILENAME}`)) {
      names.set(i, PDFString.of(FACTURX_FILENAME));
      return names.get(i + 1) as PDFRef;
    }
  }
  return undefined;
}

/** Embeds the XML as a new attachment and registers it in the EmbeddedFiles name tree. */
function attachXml(doc: PDFDocument, xml: string, now: Date): PDFRef {
  const { context, catalog } = doc;
  const data = new TextEncoder().encode(xml);
  const file = context.register(
    context.flateStream(data, {
      Type: "EmbeddedFile",
      Subtype: "text/xml",
      Params: { Size: data.length, ModDate: PDFString.fromDate(now) },
    }),
  );
  const filespec = context.register(
    context.obj({ Type: "Filespec", EF: { F: file, UF: file }, Desc: PDFHexString.fromText("Factur-X/ZUGFeRD invoice data") }),
  );

  const child = (parent: PDFDict, key: string) => {
    let dict = parent.lookupMaybe(PDFName.of(key), PDFDict);
    if (!dict) parent.set(PDFName.of(key), (dict = context.obj({})));
    return dict;
  };
  const tree = child(child(catalog, "Names"), "EmbeddedFiles");
  let names = tree.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!names) tree.set(PDFName.of("Names"), (names = context.obj([])));
  names.push(PDFString.of(FACTURX_FILENAME));
  names.push(filespec);
  return filespec;
}

/**
 * Turns a plain PDF from any template engine into a PDF/A-3b Factur-X /
 * ZUGFeRD hybrid. Neither typst.ts nor Chromium can target PDF/A-3, so this:
 *  - embeds factur-x.xml (or reuses the attachment typst's `pdf.attach` made),
 *    marks it /AFRelationship /Alternative and lists it in the catalog's /AF
 *  - adds an sRGB output intent with the bundled compact sRGB v4 ICC profile
 *    (sRGB-v4.icc, the CC0 profile typst itself embeds for PDF/A)
 *  - ensures a trailer /ID
 *  - replaces the XMP packet with PDF/A + Factur-X extension-schema metadata
 *    and keeps the Info dictionary consistent with it
 */
export async function finalizeFacturX(pdf: Uint8Array, xml: string, meta: FacturXMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { context, catalog } = doc;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);

  const filespecRef = findAttachment(doc) ?? attachXml(doc, xml, now);
  const filespec = context.lookup(filespecRef, PDFDict);
  filespec.set(PDFName.of("F"), PDFString.of(FACTURX_FILENAME));
  filespec.set(PDFName.of("UF"), PDFHexString.fromText(FACTURX_FILENAME));
  filespec.set(PDFName.of("AFRelationship"), PDFName.of("Alternative"));
  catalog.set(PDFName.of("AF"), context.obj([filespecRef]));

  catalog.set(
    PDFName.of("OutputIntents"),
    context.obj([
      context.obj({
        Type: "OutputIntent",
        S: "GTS_PDFA1",
        OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
        Info: PDFString.of("sRGB IEC61966-2.1"),
        DestOutputProfile: context.register(context.flateStream(srgbProfile, { N: 3 })),
      }),
    ]),
  );

  if (!context.trailerInfo.ID) {
    const id = PDFHexString.of(randomBytes(16).toString("hex"));
    context.trailerInfo.ID = context.obj([id, id]);
  }

  const producer = `${meta.creator} + pdf-lib`;
  context.trailerInfo.Info = context.register(context.obj({}));
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setCreator(meta.creator);
  doc.setProducer(producer);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const packet = new TextEncoder().encode(xmp(meta, producer, now.toISOString().replace(".000Z", "Z")));
  catalog.set(PDFName.of("Metadata"), context.register(context.stream(packet, { Type: "Metadata", Subtype: "XML" })));

  return doc.save({ useObjectStreams: false });
}
