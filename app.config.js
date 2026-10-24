const IOS_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const iosUrlScheme = iosClientId
    ? `com.googleusercontent.apps.${iosClientId.replace(IOS_CLIENT_ID_SUFFIX, '')}`
    : 'com.googleusercontent.apps.ios-client-not-configured';

  return {
    ...config,
    plugins: config.plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin') {
        return [plugin[0], { iosUrlScheme }];
      }
      return plugin;
    }),
  };
};
