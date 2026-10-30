const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// SkinDecode: align the generated React Native entry point BuildConfig reference.';

module.exports = function withReactNativeBuildConfigNamespace(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('SkinDecode Android Gradle namespace fix expects app/build.gradle in Groovy format.');
    }
    if (config.modResults.contents.includes(MARKER)) return config;
    const appNamespace = config.expo?.android?.package || 'com.skindecode.app';

    config.modResults.contents += `

${MARKER}
def alignReactNativeEntryPointBuildConfig = tasks.register("alignReactNativeEntryPointBuildConfig") {
    dependsOn("generateReactNativeEntryPoint")
    doLast {
        def generatedEntryPoint = file("$buildDir/generated/autolinking/src/main/java/com/facebook/react/ReactNativeApplicationEntryPoint.java")
        if (!generatedEntryPoint.exists()) {
            throw new GradleException("React Native generated entry point is missing: $generatedEntryPoint")
        }
        def source = generatedEntryPoint.getText("UTF-8")
        def expectedReference = "${appNamespace}.BuildConfig."
        def correctedSource = source.replace("com.skindecode.BuildConfig.", expectedReference)
        if (!correctedSource.contains(expectedReference)) {
            throw new GradleException("Could not align React Native BuildConfig reference with namespace ${appNamespace}")
        }
        if (correctedSource != source) generatedEntryPoint.write(correctedSource, "UTF-8")
    }
}

tasks.configureEach { task ->
    if (task.name.startsWith("compile") && task.name.endsWith("JavaWithJavac")) {
        task.dependsOn(alignReactNativeEntryPointBuildConfig)
    }
}
`;
    return config;
  });
};
