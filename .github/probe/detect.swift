import Foundation
// Link detection (what Shortcuts uses to coerce text into URLs) on each line of hashes.txt.
let lines = try! String(contentsOfFile: "hashes.txt", encoding: .utf8).split(separator: "\n").map(String.init)
let det = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
for (name, text) in zip(["A pct whole", "B pct+%2E whole", "C pct+%2E hash alone", "D b64 no prefix", "E b64_ prefix", "F pct+%2E ~2x long"], lines) {
  let ms = det.matches(in: text, range: NSRange(text.startIndex..., in: text))
  print("== \(name): \(text.count) chars, URL(string:) ok: \(URL(string: text) != nil), \(ms.count) link(s)")
  for m in ms { print("  -> [\(m.range.location)+\(m.range.length)] \(m.url!.absoluteString.prefix(140))") }
}
