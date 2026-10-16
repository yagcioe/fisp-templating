import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString } from "pdf-lib";
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

/** The Factur-X / ZUGFeRD XMP properties. */
const fxDescription = (conformanceLevel: string) => `
    <rdf:Description rdf:about="" xmlns:fx="${FX_NS}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${escapeXml(conformanceLevel)}</fx:ConformanceLevel>
    </rdf:Description>`;

/** PDF/A extension-schema entry declaring the fx properties (one item of pdfaExtension:schemas). */
const fxSchema = `
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FX_NS}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProperty("DocumentFileName", "The name of the embedded XML document")}${fxProperty("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER")}${fxProperty("Version", "The actual version of the standard applying to the embedded XML document")}${fxProperty("ConformanceLevel", "The conformance level of the embedded XML document")}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>`;

/** A Description holding pdfaExtension:schemas with the given schema entries. */
const extensionSchemas = (entries: string) => `
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>${entries}
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>`;

/** Complete XMP packet for PDFs that have none worth keeping (Chromium output). */
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
    </rdf:Description>${fxDescription(meta.conformanceLevel)}${extensionSchemas(fxSchema)}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Adds the fx properties to an existing XMP packet and leaves everything else
 * as is. The fx schema entry joins an existing pdfaExtension:schemas bag (a
 * second schemas property would be invalid RDF) or gets one of its own.
 */
function injectFacturX(packet: string, conformanceLevel: string): string {
  const bag = /<pdfaExtension:schemas>\s*<rdf:Bag>/;
  const withSchema = bag.test(packet)
    ? packet.replace(bag, (open) => open + fxSchema)
    : packet.replace("</rdf:RDF>", extensionSchemas(fxSchema) + "</rdf:RDF>");
  return withSchema.replace("</rdf:RDF>", fxDescription(conformanceLevel) + "</rdf:RDF>");
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
 * Turns a plain PDF (Chromium cannot target PDF/A-3) into a PDF/A-3b
 * Factur-X / ZUGFeRD hybrid. Engines that already produce PDF/A-3b with the
 * XML attached use addFacturXMetadata() instead. This adds what is missing
 * and replaces the metadata:
 *  - embeds factur-x.xml unless typst's `pdf.attach` already did, and makes sure
 *    it is marked /AFRelationship /Alternative and listed in the catalog's /AF
 *  - adds an sRGB output intent (bundled compact sRGB v4 ICC profile, the CC0
 *    profile typst itself embeds for PDF/A) unless one exists
 *  - ensures a trailer /ID
 *  - replaces the XMP packet with PDF/A + Factur-X extension-schema metadata
 *    and the Info dictionary with one consistent with it; the replaced objects
 *    are deleted, since pdf-lib would otherwise keep them as orphans
 */
export async function finalizeFacturX(pdf: Uint8Array, xml: string, meta: FacturXMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { context, catalog } = doc;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);

  const filespecRef = findAttachment(doc) ?? attachXml(doc, xml, now);
  const filespec = context.lookup(filespecRef, PDFDict);
  filespec.set(PDFName.of("F"), PDFString.of(FACTURX_FILENAME));
  filespec.set(PDFName.of("UF"), PDFHexString.fromText(FACTURX_FILENAME));
  if (!filespec.has(PDFName.of("AFRelationship"))) filespec.set(PDFName.of("AFRelationship"), PDFName.of("Alternative"));
  const af = catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  if (!af?.asArray().some((ref) => ref === filespecRef)) catalog.set(PDFName.of("AF"), context.obj([filespecRef]));

  if (!catalog.has(PDFName.of("OutputIntents"))) {
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
  }

  if (!context.trailerInfo.ID) {
    const id = PDFHexString.of(randomBytes(16).toString("hex"));
    context.trailerInfo.ID = context.obj([id, id]);
  }

  // Drops a replaced object (if it was indirect) so it doesn't stay in the file.
  const deleteIfRef = (obj: unknown) => obj instanceof PDFRef && context.delete(obj);

  const producer = `${meta.creator} + pdf-lib`;
  deleteIfRef(context.trailerInfo.Info);
  context.trailerInfo.Info = context.register(context.obj({}));
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setCreator(meta.creator);
  doc.setProducer(producer);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const packet = new TextEncoder().encode(xmp(meta, producer, now.toISOString().replace(".000Z", "Z")));
  deleteIfRef(catalog.get(PDFName.of("Metadata")));
  catalog.set(PDFName.of("Metadata"), context.register(context.stream(packet, { Type: "Metadata", Subtype: "XML" })));

  return doc.save({ useObjectStreams: true });
}

/**
 * For PDFs that are already PDF/A-3b with factur-x.xml attached (typst with
 * `pdfStandards: ["a3b"]` and `pdf.attach`): adds only the Factur-X XMP
 * properties, which typst cannot write. Title, author, dates, Info dictionary,
 * output intent and attachment stay exactly as the template produced them.
 */
export async function addFacturXMetadata(pdf: Uint8Array, conformanceLevel: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { context, catalog } = doc;
  if (!findAttachment(doc)) throw new Error(`PDF has no ${FACTURX_FILENAME} attachment`);

  const metadataRef = catalog.get(PDFName.of("Metadata"));
  const metadata = metadataRef instanceof PDFRef ? context.lookup(metadataRef) : undefined;
  if (!(metadataRef instanceof PDFRef) || !(metadata instanceof PDFRawStream)) {
    throw new Error("PDF has no XMP metadata stream");
  }
  const packet = new TextDecoder().decode(
    metadata.dict.has(PDFName.of("Filter")) ? inflateSync(metadata.contents) : metadata.contents,
  );

  const updated = new TextEncoder().encode(injectFacturX(packet, conformanceLevel));
  context.delete(metadataRef);
  catalog.set(PDFName.of("Metadata"), context.register(context.stream(updated, { Type: "Metadata", Subtype: "XML" })));
  return doc.save({ useObjectStreams: true });
}
