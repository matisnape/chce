import Foundation
let lines = try! String(contentsOfFile: "hashes.txt", encoding: .utf8).split(separator: "\n").map(String.init)
let det = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
for (name, text) in zip(["LIVE (dots only)", "STRICT (also !'()*~)"], lines) {
  let ms = det.matches(in: text, range: NSRange(text.startIndex..., in: text))
  print("== \(name): \(text.count) chars, \(ms.count) link(s)")
  for m in ms { print("  -> [\(m.range.location)+\(m.range.length)] ...\(m.url!.absoluteString.suffix(80))") }
  if let m = ms.first, m.range.length < text.count { let i = text.index(text.startIndex, offsetBy: m.range.length); print("  cut before: \(text[i...].prefix(60))") }
}
