import ExpoModulesCore
import AlarmKit
import ActivityKit
import SwiftUI
import AppIntents

private struct SkinDecodeAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
public struct LogWaterIntakeIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Log water intake"
  public static var description = IntentDescription("Adds one glass to your on-device water tracker.")
  public static var openAppWhenRun = false

  public init() {}

  public func perform() async throws -> some IntentResult {
    let defaults = UserDefaults.standard
    let owner = defaults.string(forKey: "skindecode.water.owner") ?? ""
    guard !owner.isEmpty else { return .result() }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.autoupdatingCurrent
    formatter.dateFormat = "yyyy-MM-dd"
    let date = formatter.string(from: Date())
    let entry = "\(owner)|\(date)|\(UUID().uuidString)"
    var pending = defaults.stringArray(forKey: "skindecode.water.pendingLogs") ?? []
    pending.append(entry)
    defaults.set(pending, forKey: "skindecode.water.pendingLogs")
    return .result()
  }
}

public class SkinDecodeAlarmModule: Module {
  private let defaultsKey = "skindecode.alarm.ids"
  private let snoozeKey = "skindecode.alarm.snooze"

  public func definition() -> ModuleDefinition {
    Name("SkinDecodeAlarm")

    Function("isAvailable") {
      if #available(iOS 26.0, *) { return true }
      return false
    }

    Function("hasPermission") {
      if #available(iOS 26.0, *) { return AlarmManager.shared.authorizationState == .authorized }
      return false
    }

    Function("getPendingWaterLogs") { (userId: String) -> [String] in
      let prefix = "\(userId)|"
      return (UserDefaults.standard.stringArray(forKey: "skindecode.water.pendingLogs") ?? [])
        .filter { $0.hasPrefix(prefix) }
        .map { String($0.dropFirst(prefix.count)) }
    }

    AsyncFunction("acknowledgeWaterLogIds") { (userId: String, localDate: String, ids: [String]) async throws -> Void in
      let prefix = "\(userId)|\(localDate)|"
      let acknowledged = Set(ids.map { prefix + $0 })
      let defaults = UserDefaults.standard
      let pending = defaults.stringArray(forKey: "skindecode.water.pendingLogs") ?? []
      defaults.set(pending.filter { !acknowledged.contains($0) }, forKey: "skindecode.water.pendingLogs")
    }

    AsyncFunction("updateWaterSnapshot") { (userId: String, localDate: String, glasses: Int, goal: Int) async throws -> Void in
      UserDefaults.standard.set(userId, forKey: "skindecode.water.owner")
      UserDefaults.standard.set(glasses, forKey: "skindecode.water.\(userId).\(localDate).glasses")
      UserDefaults.standard.set(goal, forKey: "skindecode.water.\(userId).\(localDate).goal")
    }

    AsyncFunction("requestPermission") { () async throws -> Bool in
      if #available(iOS 26.0, *) {
        return try await AlarmManager.shared.requestAuthorization() == .authorized
      }
      return false
    }

    AsyncFunction("openPermissionSettings") { () async throws -> Void in }

    AsyncFunction("setWaterReminderOwner") { (userId: String) async throws -> Void in
      UserDefaults.standard.set(userId, forKey: "skindecode.water.owner")
    }

    AsyncFunction("clearUserData") { (userId: String) async throws -> Void in
      let defaults = UserDefaults.standard
      let prefix = "skindecode.water.\(userId)."
      for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
        defaults.removeObject(forKey: key)
      }
      let pending = defaults.stringArray(forKey: "skindecode.water.pendingLogs") ?? []
      defaults.set(pending.filter { !$0.hasPrefix("\(userId)|") }, forKey: "skindecode.water.pendingLogs")
      if defaults.string(forKey: "skindecode.water.owner") == userId {
        defaults.removeObject(forKey: "skindecode.water.owner")
      }
    }

    AsyncFunction("scheduleDaily") { (hours: [Int], minutes: [Int]) async throws -> Void in
      guard #available(iOS 26.0, *) else { throw NSError(domain: "SkinDecodeAlarm", code: 26, userInfo: [NSLocalizedDescriptionKey: "iOS 26 or later is required for system alarms."]) }
      guard AlarmManager.shared.authorizationState == .authorized else { throw NSError(domain: "SkinDecodeAlarm", code: 1, userInfo: [NSLocalizedDescriptionKey: "Alarm permission is not enabled."]) }
      guard hours.count == minutes.count else { throw NSError(domain: "SkinDecodeAlarm", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid alarm schedule."]) }

      for raw in UserDefaults.standard.stringArray(forKey: defaultsKey) ?? [] {
        if let id = UUID(uuidString: raw) { try? await AlarmManager.shared.cancel(id: id) }
      }
      if let raw = UserDefaults.standard.string(forKey: snoozeKey), let id = UUID(uuidString: raw) {
        try? await AlarmManager.shared.cancel(id: id)
      }
      var saved: [String] = []
      let weekdays: [Locale.Weekday] = [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
      do {
        for index in hours.indices {
          let id = UUID()
          let presentation = AlarmPresentation(alert: AlarmPresentation.Alert(
            title: "A little water break",
            stopButton: AlarmButton(text: "I Drank It", textColor: .white, systemImageName: "drop.fill"),
            secondaryButton: AlarmButton(text: "Snooze 10 min", textColor: .white, systemImageName: "repeat"),
            secondaryButtonBehavior: .countdown
          ))
          let attributes = AlarmAttributes<SkinDecodeAlarmMetadata>(presentation: presentation, metadata: nil, tintColor: Color(red: 0.19, green: 0.36, blue: 0.28))
          let schedule = Alarm.Schedule.relative(.init(time: .init(hour: hours[index], minute: minutes[index]), repeats: .weekly(weekdays)))
          let configuration = AlarmManager.AlarmConfiguration<SkinDecodeAlarmMetadata>(
            countdownDuration: Alarm.CountdownDuration(preAlert: 0, postAlert: 600),
            schedule: schedule,
            attributes: attributes,
            stopIntent: LogWaterIntakeIntent(),
            secondaryIntent: nil,
            sound: .named("skindecode_silent_alarm.caf")
          )
          try await AlarmManager.shared.schedule(id: id, configuration: configuration)
          saved.append(id.uuidString)
        }
      } catch {
        for raw in saved { if let id = UUID(uuidString: raw) { try? await AlarmManager.shared.cancel(id: id) } }
        throw error
      }
      UserDefaults.standard.set(saved, forKey: defaultsKey)
    }

    AsyncFunction("scheduleSnooze") { (minutes: Int) async throws -> Void in
      guard #available(iOS 26.0, *) else { throw NSError(domain: "SkinDecodeAlarm", code: 26, userInfo: [NSLocalizedDescriptionKey: "System alarm snooze requires iOS 26 or later."]) }
      guard AlarmManager.shared.authorizationState == .authorized else { throw NSError(domain: "SkinDecodeAlarm", code: 1, userInfo: [NSLocalizedDescriptionKey: "Alarm permission is not enabled."]) }
      if let raw = UserDefaults.standard.string(forKey: snoozeKey), let oldID = UUID(uuidString: raw) {
        try? await AlarmManager.shared.cancel(id: oldID)
      }
      let id = UUID()
      let presentation = AlarmPresentation(alert: AlarmPresentation.Alert(
        title: "A little water break",
        stopButton: AlarmButton(text: "I Drank It", textColor: .white, systemImageName: "drop.fill"),
        secondaryButton: AlarmButton(text: "Snooze 10 min", textColor: .white, systemImageName: "repeat"),
        secondaryButtonBehavior: .countdown
      ))
      let attributes = AlarmAttributes<SkinDecodeAlarmMetadata>(presentation: presentation, metadata: nil, tintColor: Color(red: 0.19, green: 0.36, blue: 0.28))
      let delayMinutes = min(30, max(5, minutes))
      let schedule = Alarm.Schedule.fixed(Date().addingTimeInterval(TimeInterval(delayMinutes * 60)))
      let configuration = AlarmManager.AlarmConfiguration.alarm(schedule: schedule, attributes: attributes, stopIntent: LogWaterIntakeIntent(), sound: .named("skindecode_silent_alarm.caf"))
      try await AlarmManager.shared.schedule(id: id, configuration: configuration)
      UserDefaults.standard.set(id.uuidString, forKey: snoozeKey)
    }

    AsyncFunction("cancelAll") { () async throws -> Void in
      if #available(iOS 26.0, *) {
        for raw in UserDefaults.standard.stringArray(forKey: defaultsKey) ?? [] {
          if let id = UUID(uuidString: raw) { try? await AlarmManager.shared.cancel(id: id) }
        }
        if let raw = UserDefaults.standard.string(forKey: snoozeKey), let id = UUID(uuidString: raw) {
          try? await AlarmManager.shared.cancel(id: id)
        }
      }
      UserDefaults.standard.removeObject(forKey: defaultsKey)
      UserDefaults.standard.removeObject(forKey: snoozeKey)
      UserDefaults.standard.removeObject(forKey: "skindecode.water.owner")
    }
  }
}
