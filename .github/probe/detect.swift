import Foundation
// Link detection (what Shortcuts uses to coerce text into URLs) on each line of hashes.txt.
let lines = try! String(contentsOfFile: "hashes.txt", encoding: .utf8).split(separator: "\n").map(String.init)
let det = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
for (name, text) in zip(["OLD full", "NEW full", "OLD JS result alone"], lines) {
  let ms = det.matches(in: text, range: NSRange(text.startIndex..., in: text))
  print("== \(name): \(text.count) chars, URL(string:) ok: \(URL(string: text) != nil), \(ms.count) link(s)")
  for m in ms { print("  -> [\(m.range.location)+\(m.range.length)] \(m.url!.absoluteString.prefix(140))") }
}
